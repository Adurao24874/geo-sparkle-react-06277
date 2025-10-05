import React, { useEffect, useState } from 'react';
import TrendChart from './TrendChart.tsx';

type Analysis = any;

async function fetchMedianForParam(lat: number, lon: number, param: string, targetDateISO: string, buffer = 3, startYear = 2000, endYear = 2023) {
  try {
    const s = `${startYear}0101`;
    const e = `${endYear}1231`;
    // query single parameter to avoid multi-param 422
    const url = `https://power.larc.nasa.gov/api/temporal/daily/point?start=${s}&end=${e}&latitude=${lat}&longitude=${lon}&parameters=${param}&community=RE&format=JSON`;
    const res = await fetch(url);
    if (!res.ok) return NaN;
    const j = await res.json();
    const raw = j?.properties?.parameter || {};
    const chosen = Object.keys(raw)[0];
    if (!chosen) return NaN;
    const dataObj = raw[chosen] || {};
    // build map of YYYY-MM-DD -> value
    const map = new Map<string, number>();
    for (const [k, v] of Object.entries(dataObj)) {
      const yr = Number(k.slice(0, 4));
      const mo = Number(k.slice(4, 6));
      const da = Number(k.slice(6, 8));
      const d = new Date(Date.UTC(yr, mo - 1, da));
      map.set(d.toISOString().slice(0, 10), Number(v));
    }
    const target = new Date(targetDateISO);
    const tMonth = target.getUTCMonth() + 1;
    const tDay = target.getUTCDate();
    const vals: number[] = [];
    for (let y = startYear; y <= endYear; y++) {
      for (let off = -buffer; off <= buffer; off++) {
        const d = new Date(Date.UTC(y, tMonth - 1, tDay));
        d.setUTCDate(d.getUTCDate() + off);
        const key = d.toISOString().slice(0, 10);
        const v = map.get(key);
        if (v != null && Number.isFinite(v)) vals.push(Number(v));
      }
    }
    if (!vals.length) return NaN;
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  } catch (e) {
    return NaN;
  }
}

export default function AnalysisCard({ analysis, analyzing }: { analysis: Analysis | null, analyzing?: boolean }) {
  const [medianComputed, setMedianComputed] = useState<{ temp?: number; precip?: number; wind?: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    async function doIt() {
      if (!analysis || !analysis.location) return;
      const lat = Number(analysis.location.lat);
      const lon = Number(analysis.location.lon);
      const date = analysis.forecast_date || new Date().toISOString().slice(0, 10);
      // compute medians for common params
      const [mPrec, mTemp, mWind] = await Promise.all([
        fetchMedianForParam(lat, lon, 'PRECTOT', date),
        fetchMedianForParam(lat, lon, 'T2M', date),
        fetchMedianForParam(lat, lon, 'WS10M', date),
      ]);
      // prefer backend median if present in analysis.historical_stats
      const backendStats = analysis?.historical_stats;
      const beTemp = backendStats?.temp_c?.median ?? undefined;
      const bePrec = backendStats?.precip_mm?.median ?? undefined;
      const beWind = backendStats?.wind_m_s?.median ?? undefined;
      if (mounted) setMedianComputed({ temp: beTemp ?? (Number.isFinite(mTemp) ? +mTemp : undefined), precip: bePrec ?? (Number.isFinite(mPrec) ? +mPrec : undefined), wind: beWind ?? (Number.isFinite(mWind) ? +mWind : undefined) });
    }
    doIt();
    return () => { mounted = false; };
  }, [analysis]);
  return (
    <div className="w-full max-w-md lg:max-w-lg">
      <div className="bg-gradient-to-b from-white/6 to-white/3 backdrop-blur-md p-6 rounded-2xl border border-white/6 shadow-lg">
        {analysis ? (
          <div>
            {analysis.error && (
              <div className="mb-3 p-3 rounded-lg bg-red-500/15 text-red-100 text-sm whitespace-pre-wrap">
                Error: {String(analysis.error)}{analysis.status ? ` (HTTP ${analysis.status})` : ''}
                {analysis.body ? `\n${String(analysis.body).slice(0, 400)}` : ''}
              </div>
            )}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted-foreground">📍 {analysis.location?.lat?.toFixed?.(2)}, {analysis.location?.lon?.toFixed?.(2)}</div>
                <div className="text-lg font-semibold mt-1">{analysis.forecast_date}</div>
              </div>
              <div>
                <div className={`px-4 py-2 rounded-full text-sm font-semibold ${analysis.climate_risk_score >= 70 ? 'bg-red-600 text-white' : analysis.climate_risk_score >= 40 ? 'bg-yellow-400 text-black' : 'bg-green-600 text-white'}`}>
                  {analysis.climate_risk_score}% • {analysis.risk_label}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div className="p-4 bg-white/3 rounded-lg text-center">
                <div className="text-2xl">🌡️ {analysis.forecast?.temp_c ?? 'n/a'}°C</div>
                <div className="text-sm text-muted-foreground">Avg : {analysis.historical_avg?.temp_c ?? 'n/a'}°C{medianComputed?.temp != null ? ` · Median : ${medianComputed.temp?.toFixed(2)}°C` : ''}</div>
              </div>
              <div className="p-4 bg-white/3 rounded-lg text-center">
                {/* Display conservative precip (capped at historical average) from forecast.precip_mm */}
                <div className="text-2xl">
                  {
                    (() => {
                      const v = analysis?.forecast?.precip_mm;
                      return v != null ? (
                        <>
                          🌧️ {Number(v).toFixed(2)} mm
                        </>
                      ) : (
                        <>🌧️ n/a</>
                      );
                    })()
                  }
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {(() => {
                    const parts: string[] = [];
                    const adj = analysis?.forecast_adjusted?.precip_mm;
                    if (adj != null) parts.push(`Adjusted: ${Number(adj).toFixed(2)} mm`);
                    const raw = analysis?.forecast_raw?.precip_mm;
                    if (raw != null) parts.push(`Raw: ${Number(raw).toFixed(2)} mm`);
                    return parts.join(' · ');
                  })()}
                </div>
                <div className="text-sm text-muted-foreground">Hist. avg : {analysis.historical_avg?.precip_mm ?? 'n/a'} mm{medianComputed?.precip != null ? ` · Median : ${medianComputed.precip?.toFixed(2)} mm` : ''}</div>
              </div>
              <div className="p-4 bg-white/3 rounded-lg text-center">
                <div className="text-2xl">💨 {analysis.forecast?.wind_m_s ?? 'n/a'} m/s</div>
                <div className="text-sm text-muted-foreground">Avg : {analysis.historical_avg?.wind_m_s ?? 'n/a'} m/s{medianComputed?.wind != null ? ` · Median : ${medianComputed.wind?.toFixed(2)} m/s` : ''}</div>
              </div>
            </div>

            <div className="mt-4 text-sm">Dominant factor: <strong>{analysis.dominant_factor}</strong></div>

            <div className="mt-6">
              <div className="text-sm text-muted-foreground mb-2"></div>
              <div className="w-full bg-black/5 rounded p-2">
                <TrendChart data={Array.isArray(analysis.sparkline) ? analysis.sparkline.map((x: any) => Number(x)) : undefined} />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground">Enter a location to see a detailed forecast card here.</div>
        )}
      </div>
    </div>
  );
}
