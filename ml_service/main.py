from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from pymongo import MongoClient
from bson.objectid import ObjectId
from bson.errors import InvalidId
import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import mean_absolute_error, mean_squared_error, silhouette_score
from prophet import Prophet
import os
import datetime
import calendar
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
import pulp

load_dotenv(dotenv_path="../backend/.env")
MONGO_URI = os.getenv("MONGO_URI")

app = FastAPI(title="Pharma ERP ML Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = None
db_instance = None

def get_db():
    global client, db_instance
    if db_instance is None:
        try:
            client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
            db_instance = client.get_default_database()
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"Database connection failed. Are you offline? Error: {str(e)}")
    return db_instance

@app.get("/")
def read_root():
    return {"message": "Pharma ERP Machine Learning Service is running."}

@app.get("/api/ml/fmcg-clustering")
def fmcg_clustering(days: int = 365, db = Depends(get_db)):
    """
    Uses K-Means clustering to categorize products into Fast, Normal, and Slow moving.
    Applies a 2x momentum weight to sales within the last 30 days to smoothly adapt 
    to recent trends without calendar-month boundary drop-offs.
    """
    now = datetime.datetime.utcnow()
    cutoff_date = now - datetime.timedelta(days=days)
    
    recent_cutoff = now - datetime.timedelta(days=30)
    
    pipeline = [
        {"$match": {"createdAt": {"$gte": cutoff_date}}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.productId",
            "actual_quantity": {"$sum": "$items.quantity"},
            "order_frequency": {"$sum": 1},
            "total_weighted_quantity": {
                "$sum": {
                    "$multiply": [
                        "$items.quantity",
                        {"$cond": [{"$gte": ["$createdAt", recent_cutoff]}, 2.0, 1.0]}
                    ]
                }
            }
        }}
    ]
    
    sales_data = list(db.sales.aggregate(pipeline))
    if not sales_data:
        raise HTTPException(status_code=404, detail="Not enough sales data for clustering")

    df = pd.DataFrame(sales_data)
    df['productId'] = df['_id'].astype(str)

    if len(df) < 3:
        raise HTTPException(
            status_code=400, 
            detail=f"Need at least 3 distinct products to form Fast/Normal/Slow clusters. Only found {len(df)}."
        )

    X = df[['total_weighted_quantity', 'order_frequency']]
    kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
    df['cluster'] = kmeans.fit_predict(X)

    try:
        score = float(silhouette_score(X, df['cluster']))
    except ValueError:
        score = None

    cluster_centers = df.groupby('cluster')['total_weighted_quantity'].mean().sort_values(ascending=False)
    fast_cluster = cluster_centers.index[0]
    normal_cluster = cluster_centers.index[1]
    slow_cluster = cluster_centers.index[2]

    def assign_label(cluster_id):
        if cluster_id == fast_cluster: return "Fast"
        if cluster_id == normal_cluster: return "Normal"
        return "Slow"

    df['fmcg_class'] = df['cluster'].apply(assign_label)

    product_ids = []
    for pid in df['productId']:
        try:
            product_ids.append(ObjectId(pid))
        except InvalidId:
            pass

    products_cursor = db.products.find({"_id": {"$in": product_ids}}, {"name": 1})
    product_names = {str(p["_id"]): p.get("name", "Unknown") for p in products_cursor}

    results = []
    for _, row in df.iterrows():
        prod_id = row['productId']
        results.append({
            "productId": prod_id,
            "productName": product_names.get(prod_id, "Unknown"),
            "totalQuantity": int(row['actual_quantity']),
            "seasonalScore": round(float(row['total_weighted_quantity']), 2),
            "orderFrequency": int(row['order_frequency']),
            "fmcgClass": row['fmcg_class']
        })

    sorted_results = sorted(results, key=lambda x: (x['fmcgClass'] != 'Fast', -x['seasonalScore']))
    
    return {
        "silhouetteScore": round(score, 3) if score is not None else None,
        "data": sorted_results
    }


def get_month_clusters(year: int, month: int, db) -> tuple:
    """Helper function to run K-Means for a specific month and return (classes_dict, stats_dict)"""
    _, last_day = calendar.monthrange(year, month)
    start_date = datetime.datetime(year, month, 1, tzinfo=datetime.timezone.utc)
    end_date = datetime.datetime(year, month, last_day, 23, 59, 59, tzinfo=datetime.timezone.utc)
    
    pipeline = [
        {"$match": {"createdAt": {"$gte": start_date, "$lte": end_date}}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.productId",
            "quantity": {"$sum": "$items.quantity"},
            "frequency": {"$sum": 1}
        }}
    ]
    
    sales_data = list(db.sales.aggregate(pipeline))
    if not sales_data: return {}, {}

    df = pd.DataFrame(sales_data)
    if df.empty: return {}, {}
    
    df['productId'] = df['_id'].astype(str)
    if len(df) < 3: return {}, {}

    X = df[['quantity']]
    kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
    df['cluster'] = kmeans.fit_predict(X)

    cluster_centers = df.groupby('cluster')['quantity'].mean().sort_values(ascending=False)
    
    def assign_label(cluster_id):
        if cluster_id == cluster_centers.index[0]: return "Fast"
        if cluster_id == cluster_centers.index[1]: return "Normal"
        return "Slow"

    df['class'] = df['cluster'].apply(assign_label)
    
    classes_dict = pd.Series(df['class'].values, index=df['productId']).to_dict()
    stats_dict = df.set_index('productId')[['quantity', 'frequency']].to_dict('index')
    
    return classes_dict, stats_dict


@app.get("/api/ml/fmcg-clustering/monthly-compare")
def fmcg_clustering_monthly_compare(year: int, month: int, db = Depends(get_db)):
    """
    Evaluates FMCG classes for the target month and compares them to the previous month,
    flagging products that have downgraded. Optimized to reduce database load.
    """
    prev_month = 12 if month == 1 else month - 1
    prev_year = year - 1 if month == 1 else year

    prev_month_classes, _ = get_month_clusters(prev_year, prev_month, db)
    current_month_classes, current_month_stats = get_month_clusters(year, month, db)

    if not current_month_classes:
        raise HTTPException(status_code=404, detail=f"Not enough data to form clusters for {year}-{month}")

    class_scores = {"Fast": 3, "Normal": 2, "Slow": 1, "None": 0}

    product_ids = []
    for pid in current_month_stats.keys():
        try:
            product_ids.append(ObjectId(pid))
        except InvalidId:
            pass
            
    products_cursor = db.products.find({"_id": {"$in": product_ids}}, {"name": 1})
    product_names = {str(p["_id"]): p.get("name", "Unknown") for p in products_cursor}

    results = []
    for prod_id, stats in current_month_stats.items():
        current_class = current_month_classes.get(prod_id, "Slow")
        prev_class = prev_month_classes.get(prod_id, "None")
        
        current_score = class_scores[current_class]
        prev_score = class_scores[prev_class]
        
        if prev_score == 0:
            trend = "New Entry"
        elif current_score > prev_score:
            trend = "Upward"
        elif current_score < prev_score:
            trend = "Downward"
        else:
            trend = "Stable"
            
        critical_drop = (prev_class == "Fast" and current_class == "Slow")

        results.append({
            "productId": prod_id,
            "productName": product_names.get(prod_id, "Unknown"),
            "totalQuantity": int(stats['quantity']),
            "orderFrequency": int(stats['frequency']),
            "currentClass": current_class,
            "previousClass": prev_class,
            "trend": trend,
            "criticalDrop": critical_drop
        })

    sorted_results = sorted(results, key=lambda x: (not x['criticalDrop'], x['currentClass'] != 'Fast', -x['totalQuantity']))
    
    return {
        "targetMonth": f"{year}-{month:02d}",
        "comparisonMonth": f"{prev_year}-{prev_month:02d}",
        "data": sorted_results
    }


@app.get("/api/ml/forecast/{product_id}")
def demand_forecast(product_id: str, days_to_predict: int = 30, db = Depends(get_db)):
    """
    Predicts future daily sales for a specific product based on historical trends
    using the Holt-Winters Exponential Smoothing model.
    """
    try:
        obj_id = ObjectId(product_id)
        product = db.products.find_one({"_id": obj_id})
        if not product:
            raise HTTPException(status_code=400, detail=f"Product not found: {product_id}")
    except InvalidId:
        product = db.products.find_one({"name": product_id})
        if not product:
            raise HTTPException(status_code=400, detail=f"Invalid product ID format or product name not found: {product_id}")
        obj_id = product["_id"]
        product_id = str(obj_id)
        
    product_name = product.get("name", "Unknown")

    pipeline = [
        {"$unwind": "$items"},
        {"$match": {"items.productId": obj_id, "status": {"$ne": "returned"}}},
        {"$project": {
            "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt"}},
            "quantity": "$items.quantity"
        }}
    ]
    
    sales = list(db.sales.aggregate(pipeline))
    if len(sales) < 30:
        raise HTTPException(status_code=400, detail="Not enough historical data to forecast. Need at least 30 data points.")

    df = pd.DataFrame(sales)
    df['ds'] = pd.to_datetime(df['date'])
    df.rename(columns={'quantity': 'y'}, inplace=True)
    
    daily_sales = df.groupby('ds')['y'].sum().reset_index()
    daily_sales.set_index('ds', inplace=True)
    daily_sales = daily_sales.asfreq('D').reset_index()

    upper_limit = daily_sales['y'].quantile(0.99)
    daily_sales.loc[daily_sales['y'] > upper_limit, 'y'] = None

    model = Prophet(
        yearly_seasonality='auto', 
        weekly_seasonality=True, 
        daily_seasonality=False,
        changepoint_prior_scale=0.05,
        seasonality_prior_scale=10.0,
        seasonality_mode='multiplicative'
    )
    model.add_seasonality(name='monthly', period=30.5, fourier_order=5)
    
    model.add_country_holidays(country_name='LK') 
    model.fit(daily_sales)

    future = model.make_future_dataframe(periods=days_to_predict)
    forecast = model.predict(future)
    
    predictions = []
    future_forecast = forecast.tail(days_to_predict)
    for _, row in future_forecast.iterrows():
        predictions.append({"date": row['ds'].strftime("%Y-%m-%d"), "predictedQuantity": max(0, round(row['yhat'], 2))})

    return {"productId": product_id, "productName": product_name, "forecast": predictions}


@app.get("/api/ml/forecast-accuracy/{product_id}")
def evaluate_forecast(product_id: str, test_days: int = 10, db = Depends(get_db)):
    """
    Evaluates the Demand Forecasting model using backtesting.
    Splits data chronologically, trains on the older data, tests on the recent 'test_days',
    and returns MAE and RMSE metrics.
    """
    try:
        obj_id = ObjectId(product_id)
    except InvalidId:
        product = db.products.find_one({"name": product_id})
        if not product:
            raise HTTPException(status_code=400, detail=f"Invalid product ID format or product name not found: {product_id}")
        obj_id = product["_id"]
        product_id = str(obj_id)

    pipeline = [
        {"$unwind": "$items"},
        {"$match": {"items.productId": obj_id, "status": {"$ne": "returned"}}},
        {"$project": {
            "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt"}},
            "quantity": "$items.quantity"
        }}
    ]
    
    sales = list(db.sales.aggregate(pipeline))
    if len(sales) < 30 + test_days:
        raise HTTPException(
            status_code=400, 
            detail=f"Not enough historical data to evaluate. Need at least {30 + test_days} data points."
        )

    df = pd.DataFrame(sales)
    df['ds'] = pd.to_datetime(df['date'])
    df.rename(columns={'quantity': 'y'}, inplace=True)
    
    daily_sales = df.groupby('ds')['y'].sum().reset_index()
    daily_sales.set_index('ds', inplace=True)
    daily_sales = daily_sales.asfreq('D').reset_index()

    train = daily_sales.iloc[:-test_days].copy()
    actual_test = daily_sales.iloc[-test_days:].copy()

    upper_limit = train['y'].quantile(0.99)
    train.loc[train['y'] > upper_limit, 'y'] = None

    try:
        model = Prophet(
            yearly_seasonality='auto', 
            weekly_seasonality=True, 
            daily_seasonality=False,
            changepoint_prior_scale=0.05,
            seasonality_prior_scale=10.0,
            seasonality_mode='multiplicative'
        )
        model.add_seasonality(name='monthly', period=30.5, fourier_order=5)
        model.add_country_holidays(country_name='LK')
        model.fit(train)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model training failed: {str(e)}")

    future = model.make_future_dataframe(periods=test_days)
    forecast = model.predict(future)
    predictions = forecast['yhat'].tail(test_days).apply(lambda x: max(0, x)).values

    valid_mask = actual_test['y'].notna()
    valid_actuals = actual_test.loc[valid_mask, 'y']
    valid_predictions = predictions[valid_mask]

    mae = mean_absolute_error(valid_actuals, valid_predictions) if len(valid_actuals) > 0 else 0
    rmse = np.sqrt(mean_squared_error(valid_actuals, valid_predictions)) if len(valid_actuals) > 0 else 0
    
    comparison = []
    for date, actual, predicted in zip(actual_test['ds'], actual_test['y'], predictions):
        comparison.append({
            "date": date.strftime("%Y-%m-%d"),
            "actualQuantity": 0 if pd.isna(actual) else actual,
            "predictedQuantity": round(predicted, 2)
        })

    return {
        "productId": product_id,
        "testDays": test_days,
        "metrics": {
            "MAE": round(mae, 2),
            "RMSE": round(rmse, 2)
        },
        "comparison": comparison
    }
@app.get("/api/ml/optimize-profit")
def optimize_profit(
    target_net_profit: float, 
    current_monthly_expenses: float, 
    utility_costs: float = 0.0,
    innovator_brand_percentage: float = 0.0,
    lkr_devaluation_percent: float = 0.0,
    db = Depends(get_db)
):
    """
    Calculates Actual Month-to-Date Gross Profit, uses Prophet to forecast the 
    remaining days of the current month, and prescribes realistic expense reductions.
    """
    now = datetime.datetime.now()
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    days_passed = now.day
    days_remaining = max(1, days_in_month - days_passed)
    current_ym = now.strftime("%Y-%m")

    pipeline = [
        {"$unwind": "$items"},
        {"$match": {"status": {"$ne": "returned"}}},
        {"$project": {
            "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt", "timezone": "+05:30"}},
            "year_month": {"$dateToString": {"format": "%Y-%m", "date": "$createdAt", "timezone": "+05:30"}},
            "gross_profit": {
                "$multiply": [
                    {"$subtract": [
                        {"$ifNull": ["$items.price", 0]}, 
                        {"$ifNull": ["$items.costPrice", 0]}
                    ]},
                    {"$ifNull": ["$items.quantity", 1]}
                ]
            }
        }}
    ]
    
    sales = list(db.sales.aggregate(pipeline))
    if len(sales) < 30:
        raise HTTPException(status_code=400, detail="Not enough historical data to forecast profit.")

    df = pd.DataFrame(sales)
    
    mtd_df = df[df['year_month'] == current_ym]
    mtd_gross_profit = float(mtd_df['gross_profit'].sum())

    df['ds'] = pd.to_datetime(df['date'])
    df.rename(columns={'gross_profit': 'y'}, inplace=True)
    
    daily_profit = df.groupby('ds')['y'].sum().reset_index()
    daily_profit.set_index('ds', inplace=True)
    daily_profit = daily_profit.asfreq('D', fill_value=0).reset_index()

    upper_limit = daily_profit['y'].quantile(0.99)
    daily_profit['y'] = daily_profit['y'].clip(upper=upper_limit)

    try:
        model = Prophet(
            yearly_seasonality='auto', 
            weekly_seasonality=True, 
            daily_seasonality=False,
            changepoint_prior_scale=0.15,
            seasonality_mode='multiplicative'
        )
        model.add_country_holidays(country_name='LK')
        model.fit(daily_profit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model training failed: {str(e)}")

    future = model.make_future_dataframe(periods=days_remaining)
    forecast = model.predict(future)
    future_forecast = forecast.tail(days_remaining)
    
    forecasted_remaining_gross_profit = float(future_forecast['yhat'].apply(lambda x: max(0, x)).sum())

    total_expected_gross_profit = mtd_gross_profit + forecasted_remaining_gross_profit
    
    target_expenses = total_expected_gross_profit - target_net_profit
    expense_reduction_needed = current_monthly_expenses - target_expenses
    
    suggestions = []
    is_achievable = bool(target_expenses >= 0)

    if not is_achievable:
        suggestions.append("Critical: Target profit exceeds total expected Gross Profit for this month. Expense cuts alone are insufficient; you must increase sales volume or retail prices.")
    elif expense_reduction_needed > 0:
        db_actions = list(db.optimization_actions.find({"isActive": True}))
        action_pool = []
        
        for action in db_actions:
            calc_savings = action.get("savings_expense_multiplier", 0.0) * current_monthly_expenses
            if utility_costs > 0:
                calc_savings += action.get("savings_utility_multiplier", 0.0) * utility_costs
            else:
                calc_savings += action.get("fallback_expense_multiplier", 0.0) * current_monthly_expenses
                
            action_pool.append({
                "id": action["action_id"],
                "name": action["name"],
                "savings": calc_savings,
                "disruption": action.get("disruption", 1)
            })

        if not action_pool:
            suggestions.append("Warning: No active optimization actions found in the database. Please add actions to enable optimizer.")
        else:
            prob = pulp.LpProblem("Pharmacy_Expense_Optimization", pulp.LpMinimize)
            action_vars = pulp.LpVariable.dicts("Action", [action["id"] for action in action_pool], cat='Binary')
            
            prob += pulp.lpSum([action["disruption"] * action_vars[action["id"]] for action in action_pool]), "Total_Disruption"
            prob += pulp.lpSum([action["savings"] * action_vars[action["id"]] for action in action_pool]) >= expense_reduction_needed, "Meet_Savings_Target"

            if utility_costs <= (0.10 * target_net_profit) and "green_fin" in action_vars:
                prob += action_vars["green_fin"] == 0, "Disable_Green_Finance_If_Not_Needed"

            prob.solve(pulp.PULP_CBC_CMD(msg=False))

            if pulp.LpStatus[prob.status] == 'Optimal':
                total_planned_savings = 0
                for action in action_pool:
                    if action_vars[action["id"]].varValue == 1.0:
                        suggestions.append(f"{action['name']} (Est. Rs. {round(action['savings'], 2)} savings)")
                        total_planned_savings += action['savings']
                
                suggestions.insert(0, f"Optimal Action Plan: Implement the following combination to reduce expenses by ~Rs. {round(total_planned_savings, 2)} with minimal operational disruption.")
            else:
                suggestions.append(f"Warning: The mathematical optimizer could not find a combination of actions to reach the Rs. {round(expense_reduction_needed, 2)} target. Consider revising your Net Profit target.")
    else:
        suggestions.append("Excellent: Based on your current Month-to-Date profit and forecasted volume, you are already on track to hit or exceed your target. No expense reductions are needed.")

    active_alerts = []
    if expense_reduction_needed > 0 and innovator_brand_percentage > 20.0:
        active_alerts.append({
            "type": "Margin Maximization",
            "message": "Generic Counseling Alert: Current basket contains >20% innovator brands. Prompt pharmacists to offer higher-margin (up to 30%) generic alternatives."
        })
        
    if lkr_devaluation_percent > 3.0:
        active_alerts.append({
            "type": "Forex Risk",
            "message": "Stock Preservation Alert: LKR has devalued >3%. Avoid clearance sales or deep discounts on imported stock, as replacement import costs will rise sharply."
        })

    return {
        "periodDaysRemaining": days_remaining,
        "financials": {
            "actualMtdGrossProfit": round(mtd_gross_profit, 2),
            "forecastedRemainingGrossProfit": round(forecasted_remaining_gross_profit, 2),
            "totalExpectedGrossProfit": round(total_expected_gross_profit, 2),
            "targetNetProfit": round(target_net_profit, 2),
            "currentExpenses": round(current_monthly_expenses, 2),
            "targetAllowedExpenses": max(0, round(target_expenses, 2)),
            "reductionNeeded": max(0, round(expense_reduction_needed, 2))
        },
        "isAchievable": is_achievable,
        "actionPlan": suggestions,
        "activeAlerts": active_alerts
    }