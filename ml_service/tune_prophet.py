import os
import itertools
import pandas as pd
import numpy as np
import logging
from prophet import Prophet
from sklearn.metrics import mean_absolute_error, mean_squared_error
from dotenv import load_dotenv
from pymongo import MongoClient
from bson.objectid import ObjectId

logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
logging.getLogger("prophet").setLevel(logging.WARNING)

load_dotenv(dotenv_path="../backend/.env")
MONGO_URI = os.getenv("MONGO_URI")

def fetch_sales_data(product_id: str):
    """Fetches and prepares daily sales data for a given product."""
    client = MongoClient(MONGO_URI)
    db = client.get_default_database()
    
    obj_id = ObjectId(product_id)
    
    pipeline = [
        {"$unwind": "$items"},
        {"$match": {"items.productId": obj_id, "status": {"$ne": "returned"}}},
        {"$project": {
            "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt"}},
            "quantity": "$items.quantity"
        }}
    ]
    
    sales = list(db.sales.aggregate(pipeline))
    if len(sales) < 60:
        raise ValueError("Not enough historical data (need at least 60 days) to perform meaningful tuning.")

    df = pd.DataFrame(sales)
    df['ds'] = pd.to_datetime(df['date'])
    df.rename(columns={'quantity': 'y'}, inplace=True)
    
    daily_sales = df.groupby('ds')['y'].sum().reset_index()
    daily_sales.set_index('ds', inplace=True)
    daily_sales = daily_sales.asfreq('D').reset_index()
    
    return daily_sales

def grid_search_prophet(df, test_days=30):
    """Runs a grid search over hyperparameters to find the optimal Prophet configuration."""
    param_grid = {  
        'changepoint_prior_scale': [0.01, 0.05, 0.1, 0.5],
        'seasonality_prior_scale': [0.1, 1.0, 10.0],
        'seasonality_mode': ['additive', 'multiplicative']
    }

    all_params = [dict(zip(param_grid.keys(), v)) for v in itertools.product(*param_grid.values())]
    
    train = df.iloc[:-test_days].copy()
    actual_test = df.iloc[-test_days:].copy()
    
    upper_limit = train['y'].quantile(0.99)
    train.loc[train['y'] > upper_limit, 'y'] = None

    results = []
    print(f"Testing {len(all_params)} parameter combinations...")
    
    for i, params in enumerate(all_params):
        model = Prophet(
            yearly_seasonality='auto', 
            weekly_seasonality=True, 
            daily_seasonality=False,
            **params
        )
        model.add_seasonality(name='monthly', period=30.5, fourier_order=5)
        model.add_country_holidays(country_name='LK')
        
        model.fit(train)
        future = model.make_future_dataframe(periods=test_days)
        forecast = model.predict(future)
        
        predictions = forecast['yhat'].tail(test_days).apply(lambda x: max(0, x)).values
        
        valid_mask = actual_test['y'].notna()
        valid_actuals = actual_test.loc[valid_mask, 'y']
        valid_predictions = predictions[valid_mask]
        
        rmse = np.sqrt(mean_squared_error(valid_actuals, valid_predictions)) if len(valid_actuals) > 0 else 0
        mae = mean_absolute_error(valid_actuals, valid_predictions) if len(valid_actuals) > 0 else 0
        
        results.append({'params': params, 'rmse': rmse, 'mae': mae})
            
    results_df = pd.DataFrame(results).sort_values(by='rmse')
    print("\n--- Top 5 Parameter Sets ---")
    for idx, row in results_df.head(5).iterrows():
        print(f"RMSE: {row['rmse']:.2f} | MAE: {row['mae']:.2f} | Params: {row['params']}")

if __name__ == "__main__":
    TARGET_PRODUCT_ID = "REPLACE_WITH_PRODUCT_ID" 
    
    try:
        print(f"Fetching data for product: {TARGET_PRODUCT_ID}...")
        sales_df = fetch_sales_data(TARGET_PRODUCT_ID)
        
        print("Starting hyperparameter tuning grid search...")
        grid_search_prophet(sales_df, test_days=30)
        
    except Exception as e:
        print(f"Error: {e}")