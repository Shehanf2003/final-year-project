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
    
    sales = list(db.sales.find({"createdAt": {"$gte": cutoff_date}}))
    if not sales:
        raise HTTPException(status_code=404, detail="Not enough sales data for clustering")

    data = []
    for sale in sales:
        sale_date = sale.get("createdAt")
        
        if isinstance(sale_date, str):
            try:
                sale_date = datetime.datetime.fromisoformat(sale_date.replace('Z', '+00:00'))
            except ValueError:
                continue
                
        if not isinstance(sale_date, datetime.datetime):
            continue

        if sale_date.tzinfo is not None:
            sale_date = sale_date.replace(tzinfo=None)

        weight = 2.0 if sale_date >= recent_cutoff else 1.0

        for item in sale.get("items", []):
            data.append({
                "productId": str(item["productId"]),
                "weighted_quantity": item["quantity"] * weight,
                "actual_quantity": item["quantity"]
            })
    
    df = pd.DataFrame(data)
    if df.empty:
        raise HTTPException(status_code=404, detail="No items found in recent sales")

    product_stats = df.groupby('productId').agg(
        total_weighted_quantity=('weighted_quantity', 'sum'),
        actual_quantity=('actual_quantity', 'sum'),
        order_frequency=('actual_quantity', 'count')
    ).reset_index()

    if len(product_stats) < 3:
        raise HTTPException(
            status_code=400, 
            detail=f"Need at least 3 distinct products to form Fast/Normal/Slow clusters. Only found {len(product_stats)}."
        )

    X = product_stats[['total_weighted_quantity', 'order_frequency']]
    kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
    product_stats['cluster'] = kmeans.fit_predict(X)

    try:
        score = float(silhouette_score(X, product_stats['cluster']))
    except ValueError:
        score = None

    cluster_centers = product_stats.groupby('cluster')['total_weighted_quantity'].mean().sort_values(ascending=False)
    fast_cluster = cluster_centers.index[0]
    normal_cluster = cluster_centers.index[1]
    slow_cluster = cluster_centers.index[2]

    def assign_label(cluster_id):
        if cluster_id == fast_cluster: return "Fast"
        if cluster_id == normal_cluster: return "Normal"
        return "Slow"

    product_stats['fmcg_class'] = product_stats['cluster'].apply(assign_label)

    results = []
    for _, row in product_stats.iterrows():
        product = db.products.find_one({"_id": ObjectId(row['productId'])})
        results.append({
            "productId": row['productId'],
            "productName": product['name'] if product else "Unknown",
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
    daily_sales = daily_sales.asfreq('D', fill_value=0).reset_index()

    model = Prophet(yearly_seasonality='auto', weekly_seasonality=True, daily_seasonality=False)
    
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
    daily_sales = daily_sales.asfreq('D', fill_value=0).reset_index()

    train = daily_sales.iloc[:-test_days]
    actual_test = daily_sales.iloc[-test_days:]

    try:
        model = Prophet(yearly_seasonality='auto', weekly_seasonality=True, daily_seasonality=False)
        model.add_country_holidays(country_name='LK')
        model.fit(train)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model training failed: {str(e)}")

    future = model.make_future_dataframe(periods=test_days)
    forecast = model.predict(future)
    predictions = forecast['yhat'].tail(test_days).apply(lambda x: max(0, x)).values

    mae = mean_absolute_error(actual_test['y'], predictions)
    rmse = np.sqrt(mean_squared_error(actual_test['y'], predictions))
    
    comparison = []
    for date, actual, predicted in zip(actual_test['ds'], actual_test['y'], predictions):
        comparison.append({
            "date": date.strftime("%Y-%m-%d"),
            "actualQuantity": actual,
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
    days_to_predict: int = 30,
    db = Depends(get_db)
):
    """
    Uses Prophet to forecast store-wide Gross Profit, then prescribes 
    expense reductions and operational strategies using PuLP Integer Optimization.
    """
    pipeline = [
        {"$unwind": "$items"},
        {"$match": {"status": {"$ne": "returned"}}},
        {"$project": {
            "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt"}},
            "gross_profit": {
                "$multiply": [
                    {"$subtract": ["$items.price", "$items.costPrice"]},
                    "$items.quantity"
                ]
            }
        }}
    ]
    
    sales = list(db.sales.aggregate(pipeline))
    if len(sales) < 30:
        raise HTTPException(status_code=400, detail="Not enough historical data to forecast profit.")

    df = pd.DataFrame(sales)
    df['ds'] = pd.to_datetime(df['date'])
    df.rename(columns={'gross_profit': 'y'}, inplace=True)
    
    daily_profit = df.groupby('ds')['y'].sum().reset_index()
    daily_profit.set_index('ds', inplace=True)
    daily_profit = daily_profit.asfreq('D', fill_value=0).reset_index()

    try:
        model = Prophet(yearly_seasonality='auto', weekly_seasonality=True, daily_seasonality=False)
        model.add_country_holidays(country_name='LK')
        model.fit(daily_profit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model training failed: {str(e)}")

    future = model.make_future_dataframe(periods=days_to_predict)
    forecast = model.predict(future)
    future_forecast = forecast.tail(days_to_predict)
    
    forecasted_gross_profit = float(future_forecast['yhat'].apply(lambda x: max(0, x)).sum())

    target_expenses = forecasted_gross_profit - target_net_profit
    expense_reduction_needed = current_monthly_expenses - target_expenses
    
    suggestions = []
    is_achievable = bool(target_expenses >= 0)

    if not is_achievable:
        suggestions.append("Critical: Target profit exceeds forecasted Gross Profit. Expense cuts alone are insufficient; you must increase sales volume or retail prices.")
    elif expense_reduction_needed > 0:
        
        action_pool = [
            {"id": "inv_rat", "name": "Inventory Rationalization (Drop Fringe Cluster stock)", "savings": 0.05 * current_monthly_expenses, "disruption": 2},
            {"id": "brand_con", "name": "Brand Consolidation (Filter non-BE brands)", "savings": 0.03 * current_monthly_expenses, "disruption": 1},
            {"id": "proc_opt", "name": "Procurement Optimization (Bulk discounts on NCDs)", "savings": 0.08 * current_monthly_expenses, "disruption": 3},
            {"id": "util_mgt", "name": "Utility Management (TOU arbitrage / Off-peak scheduling)", "savings": utility_costs * 0.15 if utility_costs else 0.02 * current_monthly_expenses, "disruption": 2},
            {"id": "staff_ros", "name": "Staff Rostering (Sunday Closure / Pharmacist-Only Shift)", "savings": 0.15 * current_monthly_expenses, "disruption": 8},
            {"id": "green_fin", "name": "Initiate Green Loan for Solar Power System", "savings": utility_costs * 0.40 if utility_costs else 0, "disruption": 5}
        ]

        prob = pulp.LpProblem("Pharmacy_Expense_Optimization", pulp.LpMinimize)

        action_vars = pulp.LpVariable.dicts("Action", [action["id"] for action in action_pool], cat='Binary')

        prob += pulp.lpSum([action["disruption"] * action_vars[action["id"]] for action in action_pool]), "Total_Disruption"

        prob += pulp.lpSum([action["savings"] * action_vars[action["id"]] for action in action_pool]) >= expense_reduction_needed, "Meet_Savings_Target"

        if utility_costs <= (0.10 * target_net_profit):
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
        "periodDays": days_to_predict,
        "financials": {
            "forecastedGrossProfit": round(forecasted_gross_profit, 2),
            "targetNetProfit": round(target_net_profit, 2),
            "currentExpenses": round(current_monthly_expenses, 2),
            "targetAllowedExpenses": max(0, round(target_expenses, 2)),
            "reductionNeeded": max(0, round(expense_reduction_needed, 2))
        },
        "isAchievable": is_achievable,
        "actionPlan": suggestions,
        "activeAlerts": active_alerts
    }