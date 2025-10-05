#!/usr/bin/env python3
"""
scripts/forecast_power.py

Command-line utility to fetch NASA POWER daily temperature for a point,
fit a SARIMAX model (fallback to Prophet), forecast future daily temps,
compute exceedance probability for a target month, and save CSV + JSON summary.

Usage examples:
    python scripts/forecast_power.py --lat 12.91 --lon 74.85 --start 2000 --end 2024 --threshold 32 --forecast-days 90

"""
import argparse
import json
import sys
import os
from datetime import datetime, timedelta

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import io
import pandas as pd
import numpy as np

# Attempt optional imports
try:
    import pmdarima as pm
except Exception:
    pm = None

try:
    from statsmodels.tsa.statespace.sarimax import SARIMAX
except Exception:
    SARIMAX = None

try:
    from prophet import Prophet
except Exception:
    Prophet = None

import warnings
warnings.filterwarnings('ignore')


def _retry_session(total=3, backoff=0.5):
    """Create a requests.Session with retry/backoff for transient errors."""
    s = requests.Session()
    retry = Retry(
        total=total,
        backoff_factor=backoff,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "HEAD"),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount('http://', adapter)
    s.mount('https://', adapter)
    return s

_SESSION = _retry_session()

def _read_csv_with_retries(url):
    r = _SESSION.get(url, timeout=30)
    r.raise_for_status()
    return pd.read_csv(io.StringIO(r.text), comment='#')


def fetch_power_point(lat, lon, start_year, end_year, parameter='T2M_MAX'):
    start = f"{start_year}0101"
    # Cap end to today's date if requesting the current or a future year
    try:
        curr_year = datetime.utcnow().year
        end_year_int = int(end_year)
    except Exception:
        curr_year = datetime.utcnow().year
        end_year_int = curr_year
    if end_year_int >= curr_year:
        end = datetime.utcnow().strftime('%Y%m%d')
    else:
        end = f"{end_year}1231"
    base = 'https://power.larc.nasa.gov/api/temporal/daily/point'
    params = {
        'parameters': parameter,
        'community': 'RE',
        'longitude': lon,
        'latitude': lat,
        'start': start,
        'end': end,
        'format': 'JSON'
    }
    r = _SESSION.get(base, params=params, timeout=30)
    r.raise_for_status()
    j = r.json()
    data = None
    if isinstance(j, dict):
        if 'properties' in j and 'parameter' in j['properties']:
            param_block = j['properties']['parameter']
            if parameter in param_block:
                data = param_block[parameter]
        if data is None and 'parameters' in j:
            p = j['parameters']
            if parameter in p:
                data = p[parameter]
        if data is None and 'parameter' in j:
            data = j['parameter'].get(parameter)
    if data is None:
        # fallback to CSV
        csv_url = (
            f"https://power.larc.nasa.gov/api/temporal/daily/point?parameters={parameter}"
            f"&community=RE&longitude={lon}&latitude={lat}&start={start}&end={end}&format=CSV"
        )
        df = _read_csv_with_retries(csv_url)
        # Find date col
        date_col = None
        for c in df.columns:
            if 'date' in c.lower() or 'yyyy' in c.lower() or 'yyyymmdd' in c.lower():
                date_col = c
                break
        if date_col is None:
            date_col = df.columns[0]
        df[date_col] = pd.to_datetime(df[date_col].astype(str), errors='coerce')
        df = df.rename(columns={date_col: 'date'})
        # find parameter col
        param_col = None
        for c in df.columns:
            if c.upper().startswith(parameter.upper()):
                param_col = c
                break
        if param_col is None:
            param_col = parameter
        df = df[['date', param_col]].rename(columns={param_col: parameter})
        # Replace sentinel missing values (e.g., -999) with NaN
        try:
            df[parameter] = pd.to_numeric(df[parameter], errors='coerce')
            df.loc[df[parameter] <= -900, parameter] = np.nan
        except Exception:
            pass
        df = df.dropna(subset=[parameter])
        df = df.set_index('date').sort_index()
        return df
    if isinstance(data, dict):
        rows = []
        for k, v in data.items():
            try:
                dt = pd.to_datetime(k, format='%Y%m%d')
            except Exception:
                try:
                    dt = pd.to_datetime(k)
                except Exception:
                    continue
            # Treat sentinel negatives as missing
            try:
                vv = float(v)
                if vv <= -900:
                    vv = np.nan
            except Exception:
                vv = np.nan if v is None else v
            rows.append({'date': dt, parameter: (np.nan if v is None else vv)})
        df = pd.DataFrame(rows).sort_values('date').set_index('date')
        return df
    raise RuntimeError('Unexpected POWER response structure')


def fetch_power_point_multi(lat, lon, start_year, end_year, parameters=None):
    """Fetch multiple parameters in one POWER request and return a dict of DataFrames keyed by parameter."""
    if parameters is None:
        parameters = ['T2M', 'PRECTOT', 'WS2M']
    start = f"{start_year}0101"
    # Cap end to today's date if requesting the current or a future year
    try:
        curr_year = datetime.utcnow().year
        end_year_int = int(end_year)
    except Exception:
        curr_year = datetime.utcnow().year
        end_year_int = curr_year
    if end_year_int >= curr_year:
        end = datetime.utcnow().strftime('%Y%m%d')
    else:
        end = f"{end_year}1231"
    base = 'https://power.larc.nasa.gov/api/temporal/daily/point'
    params = {
        'parameters': ','.join(parameters),
        'community': 'RE',
        'longitude': lon,
        'latitude': lat,
        'start': start,
        'end': end,
        'format': 'JSON'
    }
    r = _SESSION.get(base, params=params, timeout=30)
    r.raise_for_status()
    j = r.json()
    results = {}
    # Try JSON structure
    data_block = None
    if isinstance(j, dict):
        if 'properties' in j and 'parameter' in j['properties']:
            data_block = j['properties']['parameter']
        elif 'parameters' in j:
            data_block = j['parameters']
        elif 'parameter' in j:
            data_block = j['parameter']
    if data_block is None:
        # fallback to CSV and parse per-parameter
        csv_url = (
            f"https://power.larc.nasa.gov/api/temporal/daily/point?parameters={','.join(parameters)}"
            f"&community=RE&longitude={lon}&latitude={lat}&start={start}&end={end}&format=CSV"
        )
        df = _read_csv_with_retries(csv_url)
        # find date col
        date_col = None
        for c in df.columns:
            if 'date' in c.lower() or 'yyyy' in c.lower() or 'yyyymmdd' in c.lower():
                date_col = c
                break
        if date_col is None:
            date_col = df.columns[0]
        df[date_col] = pd.to_datetime(df[date_col].astype(str), errors='coerce')
        df = df.rename(columns={date_col: 'date'}).set_index('date')
        for p in parameters:
            # find column that startswith parameter
            col = None
            for c in df.columns:
                if c.upper().startswith(p.upper()):
                    col = c
                    break
            if col is None:
                results[p] = None
            else:
                tmp = df[[col]].rename(columns={col: 'value'})
                # replace sentinel
                try:
                    tmp['value'] = pd.to_numeric(tmp['value'], errors='coerce')
                    tmp.loc[tmp['value'] <= -900, 'value'] = np.nan
                except Exception:
                    pass
                tmp = tmp.dropna()
                results[p] = tmp
        return results

    # parse JSON parameter dict
    # Returned parameter keys sometimes use slightly different names (e.g. PRECTOTCORR).
    # Match requested parameters case-insensitively and by startswith to capture aliases.
    if isinstance(data_block, dict):
        # create a mapping of lower-key -> original key for matching
        returned_keys = {k.lower(): k for k in data_block.keys()}
        for p in parameters:
            found_key = None
            p_lower = p.lower()
            # exact match
            if p_lower in returned_keys:
                found_key = returned_keys[p_lower]
            else:
                # startswith match (capture PRECTOTCORR for PRECTOT)
                for rk in returned_keys:
                    if rk.startswith(p_lower):
                        found_key = returned_keys[rk]
                        break
            if found_key and isinstance(data_block.get(found_key), dict):
                rows = []
                for k, v in data_block[found_key].items():
                    try:
                        dt = pd.to_datetime(k, format='%Y%m%d')
                    except Exception:
                        try:
                            dt = pd.to_datetime(k)
                        except Exception:
                            continue
                    # sentinel replacement
                    try:
                        vv = float(v)
                        if vv <= -900:
                            vv = np.nan
                    except Exception:
                        vv = np.nan if v is None else v
                    rows.append({'date': dt, 'value': (np.nan if v is None else vv)})
                if rows:
                    results[p] = pd.DataFrame(rows).sort_values('date').set_index('date')
                else:
                    results[p] = None
            else:
                results[p] = None
    else:
        # not a dict for some reason
        for p in parameters:
            results[p] = None
    return results


def fit_sarimax(series):
    if SARIMAX is None:
        raise RuntimeError('statsmodels SARIMAX not available')
    # attempt auto_arima if available
    order = (1, 0, 0)
    seasonal_order = (0, 0, 0, 0)
    if pm is not None:
        try:
            m = 365 if len(series) > 365*2 else 7
            auto = pm.auto_arima(series, seasonal=True, m=m, suppress_warnings=True, max_p=3, max_q=3, max_P=2, max_Q=2, stepwise=True)
            order = auto.order
            seasonal_order = auto.seasonal_order
        except Exception:
            pass
    model = SARIMAX(series, order=order, seasonal_order=seasonal_order, enforce_stationarity=False, enforce_invertibility=False)
    res = model.fit(disp=False)
    return res


def forecast_sarimax(res, start_date, steps):
    pred = res.get_forecast(steps=steps)
    mean = pred.predicted_mean
    ci = pred.conf_int(alpha=0.05)
    idx = pd.date_range(start=start_date, periods=steps, freq='D')
    df_pred = pd.DataFrame({'date': idx, 'mean': mean.values, 'lower': ci.iloc[:,0].values, 'upper': ci.iloc[:,1].values}).set_index('date')
    return df_pred


def forecast_prophet(history_df, start_date, steps):
    if Prophet is None:
        raise RuntimeError('Prophet not available')
    dfp = history_df.reset_index().rename(columns={'date':'ds','value':'y'})
    m = Prophet(daily_seasonality=True, yearly_seasonality=True)
    m.fit(dfp)
    future = m.make_future_dataframe(periods=steps)
    f = m.predict(future)
    f = f.set_index('ds')
    f = f[['yhat','yhat_lower','yhat_upper']].rename(columns={'yhat':'mean','yhat_lower':'lower','yhat_upper':'upper'})
    f = f.loc[start_date: start_date + pd.Timedelta(days=steps-1)]
    return f


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--lat', type=float, required=True)
    p.add_argument('--lon', type=float, required=True)
    p.add_argument('--start', type=int, default=2000)
    p.add_argument('--end', type=int, default=2024)
    p.add_argument('--parameter', default='T2M_MAX')
    p.add_argument('--threshold', type=float, default=32.0)
    p.add_argument('--forecast-days', type=int, default=90)
    p.add_argument('--forecast-start', default=None, help='YYYY-MM-DD or None for tomorrow')
    p.add_argument('--compact', action='store_true', help='Print a compact emoji summary (temp/rain/wind) for tomorrow')
    p.add_argument('--json-out', action='store_true', help='Emit a compact machine-readable JSON object to stdout and exit')
    args = p.parse_args(argv)

    # If user requested machine JSON output, enable compact path and silence other prints
    if args.json_out:
        args.compact = True

    df = fetch_power_point(args.lat, args.lon, args.start, args.end, args.parameter)
    df = df.rename(columns={args.parameter: 'value'})
    df = df.dropna(subset=['value'])
    if df['value'].mean() > 200:
        df['value'] = df['value'] - 273.15

    # Only print human-readable diagnostics when not in JSON output mode
    if not args.json_out:
        print('Historical range:', df.index.min(), df.index.max(), 'N=', len(df))

    if args.forecast_start:
        forecast_start = pd.to_datetime(args.forecast_start)
    else:
        forecast_start = (pd.Timestamp.today().normalize() + pd.Timedelta(days=1))

    model_res = None
    try:
        model_res = fit_sarimax(df['value'])
        if not args.json_out:
            print('SARIMAX fitted')
    except Exception as e:
        if not args.json_out:
            print('SARIMAX failed:', e)
        if Prophet is not None:
            if not args.json_out:
                print('Falling back to Prophet')
        else:
            if not args.json_out:
                print('Prophet not available; exiting')
            sys.exit(1)

    if model_res is not None:
        df_fore = forecast_sarimax(model_res, forecast_start, args.forecast_days)
    else:
        df_fore = forecast_prophet(df.reset_index().rename(columns={'date':'date','value':'value'}).set_index('date'), forecast_start, args.forecast_days)

    # compute exceedance by simulation (guard if forecast empty)
    if 'lower' in df_fore.columns and 'upper' in df_fore.columns:
        df_fore['std'] = (df_fore['upper'] - df_fore['lower']) / (2 * 1.96)
    else:
        df_fore['std'] = 1.5
    if len(df_fore) > 0:
        Nsim = 2000
        sim_matrix = np.random.normal(
            loc=np.repeat(df_fore['mean'].values.reshape(-1,1), Nsim, axis=1),
            scale=np.repeat(df_fore['std'].values.reshape(-1,1), Nsim, axis=1)
        )
        sim_exceed = (sim_matrix > args.threshold)
        prob_per_day = sim_exceed.mean(axis=1)
        overall_prob = float(sim_exceed.mean())
        df_fore['mean_exceed_prob'] = prob_per_day
        df_fore['month'] = df_fore.index.month
        monthly_fore = df_fore.groupby('month').agg(total_days=('mean_exceed_prob','size'), avg_prob=('mean_exceed_prob','mean')).reset_index()
    else:
        overall_prob = float('nan')
        monthly_fore = pd.DataFrame(columns=['month','total_days','avg_prob'])

    # Print forecast to terminal (no CSV) and output a summary JSON to outputs/
    summary = {
        'location': [args.lat, args.lon],
        'hist_start': str(df.index.min().date()),
        'hist_end': str(df.index.max().date()),
        'forecast_start': str(df_fore.index.min().date()),
        'forecast_end': str(df_fore.index.max().date()),
        'threshold_c': args.threshold,
        'overall_daily_exceed_prob': overall_prob
    }
    # save a summary JSON for programmatic use
    out_dir = os.path.join('outputs')
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'forecast_summary.json'), 'w') as f:
        json.dump(summary, f, indent=2)

    # Unless json_out is requested, print human-readable tables/summaries
    if not args.json_out:
        print('\nForecast (first 10 rows):')
        print(df_fore.reset_index().head(10).to_string(index=False))
        print('\nMonthly exceedance summary:')
        print(monthly_fore.to_string(index=False))
        print('\nSummary:')
        print(json.dumps(summary, indent=2))

    # Compact emoji summary mode (quick single-day forecast + historical averages)
    if args.compact:
        try:
            # Tomorrow date for compact summary
            tomorrow = pd.to_datetime(summary['forecast_start'])

            # attempt to fetch multiple parameters in one call
            multi = None
            try:
                multi = fetch_power_point_multi(args.lat, args.lon, args.start, args.end, parameters=['T2M','PRECTOT','WS2M'])
            except Exception:
                multi = None

            df_temp = None
            df_prec = None
            df_wind = None
            if multi is not None:
                df_temp = multi.get('T2M') if multi.get('T2M') is not None else multi.get('T2M_MAX')
                df_prec = multi.get('PRECTOT') if multi.get('PRECTOT') is not None else None
                df_wind = multi.get('WS2M') if multi.get('WS2M') is not None else None
            # fall back to individual fetches if needed
            if df_temp is None:
                try:
                    df_temp = fetch_power_point(args.lat, args.lon, args.start, args.end, parameter='T2M')
                except Exception:
                    df_temp = None
            if df_prec is None:
                try:
                    df_prec = fetch_power_point(args.lat, args.lon, args.start, args.end, parameter='PRECTOT')
                except Exception:
                    df_prec = None
            if df_wind is None:
                try:
                    df_wind = fetch_power_point(args.lat, args.lon, args.start, args.end, parameter='WS2M')
                except Exception:
                    df_wind = None

            # normalize column names and dropna when we have results
            if df_temp is not None and len(df_temp.columns) > 0:
                df_temp = df_temp.rename(columns={df_temp.columns[0]: 'value'}).dropna()
            if df_prec is not None and len(df_prec.columns) > 0:
                df_prec = df_prec.rename(columns={df_prec.columns[0]: 'value'}).dropna()
            if df_wind is not None and len(df_wind.columns) > 0:
                df_wind = df_wind.rename(columns={df_wind.columns[0]: 'value'}).dropna()

            # historical sample for the calendar day ± buffer across years (prefer this over whole-series mean)
            def sample_day_window(df, target_dt, buffer_days=3, start_yr=args.start, end_yr=args.end):
                if df is None or len(df) == 0:
                    return np.array([])
                samples = []
                tmonth = target_dt.month
                tday = target_dt.day
                for y in range(start_yr, end_yr + 1):
                    for off in range(-buffer_days, buffer_days + 1):
                        try:
                            d = pd.Timestamp(year=y, month=tmonth, day=tday) + pd.Timedelta(days=off)
                        except Exception:
                            continue
                        if d in df.index:
                            v = df.loc[d]['value']
                            if not (pd.isna(v)):
                                samples.append(float(v))
                return np.array(samples)

            # build samples and compute averages based on the ±buffer window (defaults to 3)
            buffer = 3
            temp_sample = sample_day_window(df_temp, tomorrow, buffer_days=buffer)
            prec_sample = sample_day_window(df_prec, tomorrow, buffer_days=buffer)
            wind_sample = sample_day_window(df_wind, tomorrow, buffer_days=buffer)

            def mean_or_nan(arr):
                return float(np.nan) if arr is None or len(arr) == 0 else float(np.nanmean(arr))

            hist_avg_temp = None
            hist_avg_prec = None
            hist_avg_wind = None
            if temp_sample is not None and len(temp_sample):
                hist_avg_temp = mean_or_nan(temp_sample)
            elif df_temp is not None and len(df_temp):
                hist_avg_temp = float(df_temp['value'].mean())
            if prec_sample is not None and len(prec_sample):
                hist_avg_prec = mean_or_nan(prec_sample)
            elif df_prec is not None and len(df_prec):
                hist_avg_prec = float(df_prec['value'].mean())
            if wind_sample is not None and len(wind_sample):
                hist_avg_wind = mean_or_nan(wind_sample)
            elif df_wind is not None and len(df_wind):
                hist_avg_wind = float(df_wind['value'].mean())

            # Forecast temp for one day using SARIMAX if possible, else use last value
            forecast_temp = None
            try:
                if df_temp is not None and len(df_temp) > 10:
                    res_t = fit_sarimax(df_temp['value'])
                    df_temp_fore = forecast_sarimax(res_t, tomorrow, 1)
                    forecast_temp = float(df_temp_fore['mean'].iloc[0])
                elif df_temp is not None and len(df_temp) > 0:
                    forecast_temp = float(df_temp['value'].tail(7).mean())
                else:
                    forecast_temp = None
            except Exception:
                # fallback: mean of last 7 days if available
                forecast_temp = float(df_temp['value'].tail(7).mean()) if (df_temp is not None and len(df_temp)) else None

            # Forecast precip and wind with recent mean (simple)
            forecast_prec = float(df_prec['value'].tail(7).mean()) if (df_prec is not None and len(df_prec)) else None
            forecast_wind = float(df_wind['value'].tail(7).mean()) if (df_wind is not None and len(df_wind)) else None

            # Compute richer historical stats (median, p25, p75, top5) from the sampled day-window values (needed below)
            def hist_stats_from_array(arr):
                if arr is None or len(arr) == 0:
                    return None
                a = np.array(arr)
                if a.size == 0:
                    return None
                med = float(np.median(a))
                p25 = float(np.percentile(a, 25))
                p75 = float(np.percentile(a, 75))
                top5 = [float(x) for x in sorted(a, reverse=True)[:5]]
                cnt = int(a.size)
                return {'count': cnt, 'median': med, 'p25': p25, 'p75': p75, 'top5': top5}

            stats_temp = hist_stats_from_array(temp_sample)
            stats_prec = hist_stats_from_array(prec_sample)
            stats_wind = hist_stats_from_array(wind_sample)

            # Compute an adjusted (shrunk) forecast that blends the short-term forecast with climatology using a simple Bayesian shrinkage
            def compute_shrunk(forecast_val, forecast_var, prior_mean, prior_var):
                try:
                    if forecast_val is None and prior_mean is None:
                        return None
                    if forecast_val is None:
                        return prior_mean
                    if prior_mean is None:
                        return forecast_val
                    # avoid zero variances
                    forecast_var = float(forecast_var) if (forecast_var is not None and forecast_var > 0) else 1.0
                    prior_var = float(prior_var) if (prior_var is not None and prior_var > 0) else 1.0
                    post_mean = (forecast_val / forecast_var + prior_mean / prior_var) / (1.0 / forecast_var + 1.0 / prior_var)
                    return float(post_mean)
                except Exception:
                    return forecast_val if forecast_val is not None else prior_mean

            # compute prior variance from sampled historical precip (use sample variance if available)
            prior_prec_var = None
            try:
                if prec_sample is not None and len(prec_sample) > 1:
                    prior_prec_var = float(np.var(prec_sample, ddof=1))
                elif stats_prec is not None and stats_prec.get('p75') is not None and stats_prec.get('p25') is not None:
                    # approximate sd from IQR (IQR/1.349)
                    iqr = float(stats_prec['p75'] - stats_prec['p25'])
                    prior_prec_var = (iqr / 1.349) ** 2 if iqr > 0 else 1.0
            except Exception:
                prior_prec_var = None

            adjusted_prec = None
            if forecast_prec is not None:
                # compute recent precipitation variance (short-term forecast uncertainty proxy)
                recent_prec_var = None
                try:
                    if df_prec is not None and len(df_prec) >= 2:
                        recent_vals = df_prec['value'].tail(14).astype(float)
                        if len(recent_vals) >= 2:
                            recent_prec_var = float(np.var(recent_vals.values, ddof=1))
                except Exception:
                    recent_prec_var = None
                # choose a reasonable prior mean (median of day-window preferred)
                prior_mean_prec = None
                if stats_prec is not None and 'median' in stats_prec:
                    prior_mean_prec = float(stats_prec['median'])
                elif hist_avg_prec is not None:
                    prior_mean_prec = float(hist_avg_prec)
                # If we have both variances, compute a weight for prior vs recent by relative uncertainty.
                # More recent variance -> more weight on prior (climatology). Clamp to [0.3, 0.9].
                weight_prior = None
                try:
                    if (recent_prec_var is not None and recent_prec_var > 0) and (prior_prec_var is not None and prior_prec_var > 0):
                        weight_prior = float(recent_prec_var / (recent_prec_var + prior_prec_var))
                        weight_prior = max(0.3, min(0.9, weight_prior))
                except Exception:
                    weight_prior = None
                if weight_prior is not None and prior_mean_prec is not None:
                    adjusted_prec = float(weight_prior * prior_mean_prec + (1.0 - weight_prior) * forecast_prec)
                else:
                    # fallback to Bayesian shrink function with reasonable defaults
                    adjusted_prec = compute_shrunk(forecast_prec, recent_prec_var, prior_mean_prec, prior_prec_var)
                # ensure non-negative
                if adjusted_prec is not None and adjusted_prec < 0:
                    adjusted_prec = 0.0

            # Units: temperature C (assuming data already in C), precip mm, wind m/s
            # Build a compact JSON summary

            # Build a small sparkline based on forecast means if available, else recent temp history
            sparkline = None
            try:
                if df_fore is not None and 'mean' in df_fore.columns and len(df_fore) > 0:
                    # normalize to 0..1 for visualization
                    vals = df_fore['mean'].astype(float).values
                    # take up to 20 points
                    vals = vals[:20]
                    vmin = float(np.nanmin(vals))
                    vmax = float(np.nanmax(vals))
                    rng = max(1e-6, vmax - vmin)
                    sparkline = [float((v - vmin) / rng) for v in vals]
                elif df_temp is not None and len(df_temp) > 0:
                    vals = df_temp['value'].tail(20).astype(float).values
                    vmin = float(np.nanmin(vals))
                    vmax = float(np.nanmax(vals))
                    rng = max(1e-6, vmax - vmin)
                    sparkline = [float((v - vmin) / rng) for v in vals]
            except Exception:
                sparkline = None

            # Display precipitation constrained within historical values:
            # Prefer clamping base forecast into [p25, p75]. If not available, clamp into [min(median, avg), max(median, avg)].
            display_prec = None
            try:
                base_prec = adjusted_prec if (adjusted_prec is not None) else forecast_prec
                if base_prec is not None:
                    bp = float(base_prec)
                    lo = None
                    hi = None
                    if stats_prec is not None and stats_prec.get('p25') is not None and stats_prec.get('p75') is not None:
                        p25 = float(stats_prec['p25']); p75 = float(stats_prec['p75'])
                        lo = min(p25, p75); hi = max(p25, p75)
                    else:
                        med = float(stats_prec['median']) if (stats_prec is not None and stats_prec.get('median') is not None) else None
                        avg = float(hist_avg_prec) if (hist_avg_prec is not None) else None
                        if med is not None and avg is not None:
                            lo = min(med, avg); hi = max(med, avg)
                        elif med is not None:
                            lo = 0.0; hi = med
                        elif avg is not None:
                            lo = 0.0; hi = avg
                    if lo is not None and hi is not None:
                        display_prec = float(max(0.0, min(max(bp, lo), hi)))
                    else:
                        display_prec = float(max(0.0, bp))
            except Exception:
                display_prec = float(max(0.0, forecast_prec)) if (forecast_prec is not None) else None

            # Rain-centric risk: map displayed precipitation (already clamped to historical range) to a 0–100 "rain likelihood" score.
            # Ensures < 1 mm -> Low, 1–5 mm -> Medium band, > 5 mm -> High band.
            rain_mm_for_risk = None
            try:
                # prefer display_prec, fallback to adjusted or raw forecast
                candidate = display_prec if (display_prec is not None) else (adjusted_prec if (adjusted_prec is not None) else forecast_prec)
                rain_mm_for_risk = float(candidate) if (candidate is not None) else None
            except Exception:
                rain_mm_for_risk = None

            def rain_score(mm):
                if mm is None or mm <= 0:
                    return 0
                if mm < 1.0:
                    return 15  # clearly low
                if mm < 5.0:
                    # scale 1..5 mm to 40..70
                    return 40 + (mm - 1.0) / 4.0 * 30
                if mm < 20.0:
                    # scale 5..20 mm to 70..100
                    return 70 + (mm - 5.0) / 15.0 * 30
                return 100

            score = int(round(rain_score(rain_mm_for_risk)))
            if score >= 70:
                risk_label = 'High Risk'
            elif score >= 40:
                risk_label = 'Medium Risk'
            else:
                risk_label = 'Low Risk'

            dominant = 'Rain'

            compact = {
                'location': {'lat': args.lat, 'lon': args.lon},
                'forecast_date': str(tomorrow.date()),
                'forecast': {'temp_c': None if forecast_temp is None else float(round(forecast_temp, 2)),
                             # Display a conservative precipitation (capped at historical average)
                             'precip_mm': None if display_prec is None else float(round(display_prec, 2)),
                             'wind_m_s': None if forecast_wind is None else float(round(forecast_wind, 2))},
                'historical_avg': {'temp_c': None if hist_avg_temp is None else float(round(hist_avg_temp, 2)),
                                   'precip_mm': None if hist_avg_prec is None else float(round(hist_avg_prec, 2)),
                                   'wind_m_s': None if hist_avg_wind is None else float(round(hist_avg_wind, 2))},
                'historical_stats': {
                    'temp_c': stats_temp,
                    'precip_mm': stats_prec,
                    'wind_m_s': stats_wind
                },
                'forecast_adjusted': {'precip_mm': None if adjusted_prec is None else float(round(adjusted_prec, 2))},
                # Include raw precipitation for transparency
                'forecast_raw': {'precip_mm': None if forecast_prec is None else float(round(forecast_prec, 2))},
                'climate_risk_score': score,
                'risk_label': risk_label,
                'dominant_factor': dominant,
                'sparkline': sparkline
            }
            if args.json_out:
                # Emit compact JSON on stdout and exit
                print(json.dumps(compact))
                return
            else:
                print('\n📍 Location: lat', args.lat, 'lon', args.lon)
                def fmt(v):
                    return f"{v:.2f}" if (v is not None) else 'n/a'
                print(f'🌧️ Forecast Rain Tomorrow: {fmt(forecast_prec)} mm | Historical Avg: {fmt(hist_avg_prec)} mm')
                print(f'🌡️ Forecast Temp: {fmt(forecast_temp)}°C | Historical Avg: {fmt(hist_avg_temp)}°C')
                print(f'💨 Forecast Wind: {fmt(forecast_wind)} m/s | Historical Avg: {fmt(hist_avg_wind)} m/s')
                print('\n')
                print(f'📊 Climate Risk Score: {score}% → ✅ {risk_label}')
                print(f'🔷 Dominant Factor: {dominant}')

        except Exception as e:
            print('Compact summary failed:', e)


if __name__ == '__main__':
    main()
