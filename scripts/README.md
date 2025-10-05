# Forecast POWER script

This folder contains `forecast_power.py`, a command-line script that:

- Fetches daily temperature data from the NASA POWER API for a point (latitude/longitude).
- Fits a SARIMAX model (uses pmdarima auto_arima to pick orders if available) and forecasts daily temperatures.
- Falls back to Prophet if SARIMAX cannot be used.
- Simulates forecast uncertainty and computes exceedance probability for a supplied temperature threshold.
- Saves forecast CSV and a JSON summary in the `outputs/` directory.

Usage example:

```bash
python scripts/forecast_power.py --lat 12.91 --lon 74.85 --start 2000 --end 2024 --threshold 32 --forecast-days 90
```

Notes:
- Install required packages: `pip install requests pandas numpy matplotlib seaborn scipy statsmodels pmdarima`.
- Prophet is optional: `pip install prophet`.
- Output files are saved to `outputs/`.
