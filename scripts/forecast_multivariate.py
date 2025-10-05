#!/usr/bin/env python3
"""
scripts/forecast_multivariate.py

Multivariate forecasting using NASA POWER point data.
Default variables: T2M (temp), RH2M (relative humidity), WS2M (wind speed), PRECTOT (precipitation) as a proxy for clouds.

Approach:
- Fetch daily data for the requested variables via NASA POWER (CSV endpoint).
- Build lag features (e.g., 1..7 days) for each variable.
- Train a RandomForestRegressor to predict next-day T2M using lagged features.
- Iteratively forecast multiple days ahead using persistence for exogenous variables (repeat last observed values).
- Simulate forecast uncertainty by sampling residuals and produce exceedance probabilities.

Usage example:
  python scripts/forecast_multivariate.py --lat 12.91 --lon 74.85 --start 2000 --end 2024 --threshold 32 --forecast-days 90

"""
import argparse
import os
import json
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import io

# ML imports
try:
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import mean_squared_error
except Exception:
    RandomForestRegressor = None

import warnings
warnings.filterwarnings('ignore')
def _retry_session(total=3, backoff=0.5):
    s = requests.Session()
    retry = Retry(total=total, backoff_factor=backoff, status_forcelist=(429,500,502,503,504), allowed_methods=("GET","HEAD"), raise_on_status=False)
    adapter = HTTPAdapter(max_retries=retry)
    s.mount('http://', adapter)
    s.mount('https://', adapter)
    return s

_SESSION = _retry_session()


DEFAULT_VARS = ['T2M', 'RH2M', 'WS2M', 'PRECTOT']


def fetch_power_csv(lat, lon, start_year, end_year, parameters):
    """Fetch POWER CSV for multiple parameters and return DataFrame with date index and columns for each parameter."""
    start = f"{start_year}0101"
    end = f"{end_year}1231"
    params = ','.join(parameters)
    csv_url = (
        f"https://power.larc.nasa.gov/api/temporal/daily/point?parameters={params}"
        f"&community=RE&longitude={lon}&latitude={lat}&start={start}&end={end}&format=CSV"
    )
    r = _SESSION.get(csv_url, timeout=30)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text), comment='#')
    # find date column
    date_col = None
    for c in df.columns:
        if 'date' in c.lower() or 'yyyy' in c.lower():
            date_col = c
            break
    if date_col is None:
        date_col = df.columns[0]
    df[date_col] = pd.to_datetime(df[date_col].astype(str), errors='coerce')
    df = df.rename(columns={date_col: 'date'})
    df = df.set_index('date').sort_index()
    # ensure desired columns present (prefix matching)
    result = pd.DataFrame(index=df.index)
    for p in parameters:
        # try exact match, otherwise search for columns starting with p
        col = None
        for c in df.columns:
            if c.upper() == p.upper() or c.upper().startswith(p.upper()):
                col = c
                break
        if col is None:
            # create column of NaNs
            result[p] = np.nan
        else:
            result[p] = df[col].values
    return result


def create_lag_features(df, lags=7):
    """Given DataFrame with columns for variables, create lag features for each var up to `lags` days (1..lags)."""
    out = pd.DataFrame(index=df.index)
    for col in df.columns:
        for lag in range(1, lags+1):
            out[f"{col}_lag{lag}"] = df[col].shift(lag)
    # also include current-day exogenous values optionally
    for col in df.columns:
        out[f"{col}_curr"] = df[col]
    return out


def train_model(df, target_col='T2M', lags=7):
    """Train a RandomForest to predict next-day target using lag features of all variables.
    Returns model, feature names, training residuals.
    """
    if RandomForestRegressor is None:
        raise RuntimeError('scikit-learn not available; please install scikit-learn')
    # Build features
    features = create_lag_features(df, lags=lags)
    # Target is target_col shifted - predict next day value
    y = df[target_col].shift(-1)
    data = pd.concat([features, y.rename('target')], axis=1).dropna()
    X = data.drop(columns=['target'])
    y = data['target']
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, shuffle=False)
    model = RandomForestRegressor(n_estimators=200, n_jobs=-1, random_state=0)
    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    residuals = (y_test - preds)
    print(f"Trained RandomForest, test RMSE={rmse:.3f}")
    return model, X.columns.tolist(), residuals


def iterative_forecast(model, df_hist, forecast_days, features_cols, lags=7):
    """Iteratively forecast `forecast_days` ahead. For exogenous variables (non-target), use persistence (last observed value).
    df_hist: historical DataFrame with columns matching DEFAULT_VARS and date index.
    Returns DataFrame with forecasted mean values.
    """
    last_date = df_hist.index.max()
    # start from the last known day
    history = df_hist.copy()
    results = []
    for step in range(1, forecast_days+1):
        # construct feature vector for next day using last lags
        # For each variable and lag, get values
        row = {}
        for col in df_hist.columns:
            # current day's value is last available in history
            vals = history[col].values
            for lag in range(1, lags+1):
                # lag1 = yesterday -> take -1, lag2 -> -2, etc.
                idx = -lag
                if len(vals) >= abs(idx):
                    row[f"{col}_lag{lag}"] = float(vals[idx])
                else:
                    row[f"{col}_lag{lag}"] = float(vals[0])
            # current exog - persistence: use last observed value
            row[f"{col}_curr"] = float(vals[-1])
        # ensure feature order
        x = np.array([row[c] for c in features_cols]).reshape(1, -1)
        ypred = float(model.predict(x)[0])
        # append predicted temp as new 'T2M' for history so next iteration uses it as lag
        new_date = last_date + pd.Timedelta(days=step)
        # For other exog (RH2M, WS2M, PRECTOT) we use persistence of last observed
        new_row = {}
        for col in df_hist.columns:
            if col == 'T2M':
                new_row[col] = ypred
            else:
                new_row[col] = float(history[col].iloc[-1])
        history = pd.concat([history, pd.DataFrame(new_row, index=[new_date])])
        results.append({'date': new_date, 'mean': ypred})
    df_fore = pd.DataFrame(results).set_index('date')
    return df_fore


def simulate_uncertainty(df_fore, residuals, nsim=2000):
    """Simulate future series by adding sampled residuals to mean forecast per day to estimate exceedance probabilities."""
    res_vals = residuals.values
    if len(res_vals) == 0:
        res_std = 1.5
    else:
        res_std = res_vals.std()
    N = nsim
    means = df_fore['mean'].values
    sims = np.random.normal(loc=np.repeat(means.reshape(-1,1), N, axis=1), scale=res_std)
    return sims


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--lat', type=float, required=True)
    parser.add_argument('--lon', type=float, required=True)
    parser.add_argument('--start', type=int, default=2000)
    parser.add_argument('--end', type=int, default=2024)
    parser.add_argument('--vars', nargs='+', default=DEFAULT_VARS, help='POWER parameters to fetch (e.g., T2M RH2M WS2M PRECTOT)')
    parser.add_argument('--threshold', type=float, default=32.0)
    parser.add_argument('--forecast-days', type=int, default=90)
    parser.add_argument('--lags', type=int, default=7)
    args = parser.parse_args(argv)

    if RandomForestRegressor is None:
        raise RuntimeError('scikit-learn is required. Run: pip install scikit-learn')

    print('Fetching data from POWER...')
    df = fetch_power_csv(args.lat, args.lon, args.start, args.end, args.vars)
    # rename T2M to ensure target name
    if 'T2M' not in df.columns:
        # try common T2M variants
        for c in df.columns:
            if 'T2M' in c.upper():
                df = df.rename(columns={c:'T2M'})
                break
    # ensure index is daily continuous - reindex
    idx = pd.date_range(start=df.index.min(), end=df.index.max(), freq='D')
    df = df.reindex(idx)
    # forward/backfill small gaps
    df = df.fillna(method='ffill').fillna(method='bfill')

    print('Data loaded, columns:', df.columns.tolist(), 'date range:', df.index.min(), df.index.max())

    # Train model
    model, feat_cols, residuals = train_model(df, target_col='T2M', lags=args.lags)

    # Forecast
    df_fore = iterative_forecast(model, df, args.forecast_days, feat_cols, lags=args.lags)

    # Simulate uncertainty
    sims = simulate_uncertainty(df_fore, residuals, nsim=2000)
    exceed = (sims > args.threshold)
    prob_per_day = exceed.mean(axis=1)
    overall_prob = exceed.mean()

    df_fore['mean_exceed_prob'] = prob_per_day

    out_dir = 'outputs'
    os.makedirs(out_dir, exist_ok=True)
    out_csv = os.path.join(out_dir, f'multivar_forecast_{int(args.lat*100)}_{int(args.lon*100)}_{datetime.today().date()}.csv')
    df_fore.reset_index().to_csv(out_csv, index=False)
    summary = {
        'location': [args.lat, args.lon],
        'hist_start': str(df.index.min().date()),
        'hist_end': str(df.index.max().date()),
        'forecast_start': str(df_fore.index.min().date()),
        'forecast_end': str(df_fore.index.max().date()),
        'threshold': args.threshold,
        'overall_daily_exceed_prob': float(overall_prob)
    }
    with open(os.path.join(out_dir, 'multivar_forecast_summary.json'), 'w') as f:
        json.dump(summary, f, indent=2)
    print('Saved forecast CSV and summary to', out_dir)
    print('Overall daily exceedance probability (averaged across forecast days):', overall_prob)


if __name__ == '__main__':
    main()
