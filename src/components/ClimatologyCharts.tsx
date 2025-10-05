import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

type Props = {
  lat?: number;
  lon?: number;
  targetDate?: string; // YYYY-MM-DD
  buffer?: number; // days each side
  startYear?: number;
  endYear?: number;
  param?: string; // NASA POWER parameter (e.g., PRECTOT)
};

// Helper: build date for year with offset
function dateWithOffset(year: number, month: number, day: number, offset: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

export default function ClimatologyCharts({ lat, lon, targetDate, buffer = 3, startYear = 2000, endYear = 2024, param = 'PRECTOT' }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yearSeries, setYearSeries] = useState<Record<number, (number | null)[]>>({});
  const [histValues, setHistValues] = useState<number[]>([]);
  const [usedParam, setUsedParam] = useState<string | null>(param);

  useEffect(() => {
    if (lat == null || lon == null) return;
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // NASA POWER daily point API - try each candidate parameter in sequence with single-parameter requests
        const s = `${startYear}0101`;
        // Cap end date to today if endYear is the current year
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const e = endYear >= currentYear
          ? `${currentYear}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`
          : `${endYear}1231`;
        const candidates = [param, 'PRECTOTCORR', 'PRECTOT', 'T2M', 'T2M_MAX', 'T2M_MIN', 'WS10M', 'WS10M_SFC'];
        let chosen: string | null = null;
        let raw: any = null;
        let lastErr: any = null;
        for (const c of candidates) {
          if (!c) continue;
          try {
            const url = `https://power.larc.nasa.gov/api/temporal/daily/point?start=${s}&end=${e}&latitude=${lat}&longitude=${lon}&parameters=${c}&community=RE&format=JSON`;
            const resC = await fetch(url);
            if (!resC.ok) {
              // skip and try next candidate
              lastErr = `POWER ${c} fetch failed: ${resC.status}`;
              continue;
            }
            const jsonC = await resC.json();
            const paramObj = jsonC?.properties?.parameter || {};
            if (paramObj && paramObj[c]) {
              chosen = c;
              raw = paramObj[c];
              break;
            }
            // if response contains other parameters, pick one available
            const avail = Object.keys(paramObj || {});
            if (avail.length > 0) {
              chosen = avail[0];
              raw = paramObj[chosen];
              break;
            }
          } catch (err) {
            lastErr = err;
            continue;
          }
        }
        if (!chosen || !raw) {
          throw new Error(`No data returned from POWER for parameters tried. Last error: ${String(lastErr)}`);
        }
        setUsedParam(chosen);

        // Build a map dateStr->value
        const dataMap = new Map<string, number>();
        for (const [dateStr, v] of Object.entries(raw)) {
          // dateStr format YYYYMMDD
          const year = Number(dateStr.slice(0, 4));
          const month = Number(dateStr.slice(4, 6));
          const day = Number(dateStr.slice(6, 8));
          const d = new Date(Date.UTC(year, month - 1, day));
          let val = Number(v);
          if (!Number.isFinite(val) || val <= -900) {
            continue; // skip sentinel/missing
          }
          dataMap.set(d.toISOString().slice(0, 10), val);
        }

        const target = targetDate ? new Date(targetDate) : new Date(Date.UTC(endYear, 0, 1));
        const tMonth = target.getUTCMonth() + 1;
        const tDay = target.getUTCDate();

        const years: number[] = [];
        for (let y = startYear; y <= endYear; y++) years.push(y);

        const seriesMap: Record<number, (number | null)[]> = {};
        const allHist: number[] = [];

        for (const y of years) {
          const vals: (number | null)[] = [];
          for (let off = -buffer; off <= buffer; off++) {
            const d = dateWithOffset(y, tMonth, tDay, off);
            const key = d.toISOString().slice(0, 10);
            const v = dataMap.has(key) ? dataMap.get(key) as number : null;
            vals.push(v === undefined ? null : v);
            if (v != null && Number.isFinite(v)) allHist.push(v);
          }
          seriesMap[y] = vals;
        }

        if (!cancelled) {
          setYearSeries(seriesMap);
          setHistValues(allHist);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e.message || e));
          setLoading(false);
        }
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [lat, lon, targetDate, buffer, startYear, endYear, param]);

  const labels = Array.from({ length: buffer * 2 + 1 }, (_, i) => (i - buffer).toString());

  // units helper (simple heuristic)
  const unitsFor = (p: string | null) => {
    if (!p) return '';
    if (p.includes('PREC') || p.includes('PRECTOT')) return 'mm/day';
    if (p.includes('T2M')) return '°C';
    if (p.includes('WS') || p.includes('WIND')) return 'm/s';
    return '';
  };

  const friendlyParamName = (p: string | null) => {
    if (!p) return 'Parameter';
    if (p === 'PRECTOTCORR') return 'Precipitation (corrected, mm/day)';
    if (p === 'PRECTOT') return 'Precipitation (mm/day)';
    if (p.includes('PRECTOT')) return 'Precipitation (mm/day)';
    if (p.includes('T2M')) return 'Temperature (°C)';
    if (p.includes('WS')) return 'Wind speed (m/s)';
    return p;
  };

  // compute median and IQR across years for each offset to create a summary series
  const { medianSeries, q1Series, q3Series, medianSummary } = (() => {
    const positions = labels.length;
    const arrays: number[][] = Array.from({ length: positions }, () => []);
    const years = Object.keys(yearSeries).map((k) => Number(k)).sort((a, b) => a - b);
    for (const y of years) {
      const vals = yearSeries[y] || [];
      for (let i = 0; i < positions; i++) {
        const v = vals[i];
        if (v != null && Number.isFinite(v)) arrays[i].push(Number(v));
      }
    }
    const median = (arr: number[]) => {
      if (!arr.length) return NaN;
      const sorted = arr.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const quantile = (arr: number[], q: number) => {
      if (!arr.length) return NaN;
      const s = arr.slice().sort((a, b) => a - b);
      const pos = (s.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (s[base + 1] !== undefined) return s[base] + rest * (s[base + 1] - s[base]);
      return s[base];
    };
    const med: number[] = [];
    const q1: number[] = [];
    const q3: number[] = [];
    for (let i = 0; i < positions; i++) {
      med.push(Number.isFinite(median(arrays[i])) ? +median(arrays[i]).toFixed(2) : NaN);
      q1.push(Number.isFinite(quantile(arrays[i], 0.25)) ? +quantile(arrays[i], 0.25).toFixed(2) : NaN);
      q3.push(Number.isFinite(quantile(arrays[i], 0.75)) ? +quantile(arrays[i], 0.75).toFixed(2) : NaN);
    }
    // summary for caption: median of medians, and IQR at center position
    const centerIdx = Math.floor(positions / 2);
    const medOfMeds = Number.isFinite(med[centerIdx]) ? med[centerIdx] : NaN;
    const iqrCenter = Number.isFinite(q1[centerIdx]) && Number.isFinite(q3[centerIdx]) ? `${q1[centerIdx]}–${q3[centerIdx]}` : '';
    return { medianSeries: med, q1Series: q1, q3Series: q3, medianSummary: { medOfMeds, iqrCenter } };
  })();

  // Build datasets for line chart
  const datasets = Object.keys(yearSeries).map((yk, idx) => {
    const y = Number(yk);
    const vals = yearSeries[y];
    return {
      label: String(y),
      data: vals || [] as (number | null)[],
      borderColor: idx === Object.keys(yearSeries).length - 1 ? 'rgba(255,99,132,1)' : 'rgba(59,130,246,0.25)',
      backgroundColor: idx === Object.keys(yearSeries).length - 1 ? 'rgba(255,99,132,0.1)' : 'rgba(59,130,246,0.03)',
      tension: 0.25,
      pointRadius: 0,
    };
  });

  // add median series as a highlighted line
  const medianDataset = {
    label: 'Median',
    data: medianSeries.map((v: any) => (Number.isFinite(v) ? v : null)),
    borderColor: 'rgba(250,204,21,1)',
    backgroundColor: 'rgba(250,204,21,0.08)',
    borderWidth: 2.5,
    tension: 0.25,
    pointRadius: 2,
  };

  const fullDatasets = [...datasets, medianDataset];

  const lineData = { labels, datasets: fullDatasets };
  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            const y = context.parsed?.y;
            const label = context.dataset?.label || '';
            const unit = unitsFor(usedParam);
            return `${label}: ${y == null || Number.isNaN(y) ? 'n/a' : `${y}${unit ? ' ' + unit : ''}`}`;
          }
        }
      }
    },
    scales: {
      x: { title: { display: true, text: 'Days from date' }, ticks: { font: { size: 12 } } },
      y: { title: { display: true, text: `${usedParam ?? ''} ${unitsFor(usedParam) ? `(${unitsFor(usedParam)})` : ''}` }, ticks: { font: { size: 12 } } }
    }
  } as any;

  // Histogram: simple binning
  const histData = (() => {
    if (!histValues || histValues.length === 0) return { labels: [], counts: [] };
    const bins = 12;
    const min = Math.min(...histValues);
    const max = Math.max(...histValues);
    const step = (max - min) / bins || 1;
    const counts = Array.from({ length: bins }, () => 0);
    const labelsH: string[] = [];
    for (const v of histValues) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
      counts[idx] += 1;
    }
    for (let i = 0; i < bins; i++) {
      const a = (min + i * step).toFixed(1);
      const b = (min + (i + 1) * step).toFixed(1);
      labelsH.push(`${a}–${b}`);
    }
    return { labels: labelsH, counts };
  })();

  const barData = { labels: histData.labels, datasets: [{ label: 'Count', data: histData.counts, backgroundColor: 'rgba(99,102,241,0.85)' }] };
  const barOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } as any;

  return (
    <div className="space-y-4">
      {loading && <div className="text-sm text-muted-foreground">Loading climatology...</div>}
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="bg-card/90 p-3 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Historical (±{buffer} days) — multi-year{usedParam ? ` · ${friendlyParamName(usedParam)}` : ''}</div>
        </div>
        {/* Plain-language axis captions */}
        <div className="text-xs text-muted-foreground mb-3">
          <div><strong>X axis —</strong> Days from selected date. 0 = the selected day; −1 = one day before; +1 = one day after.</div>
          <div>
            <strong>Y axis —</strong> {usedParam && usedParam.includes('PREC') ? 'Precipitation (mm per day): daily rainfall in millimetres. Higher numbers = more rain.' : usedParam && usedParam.includes('T2M') ? 'Temperature (°C): daily mean temperature in degrees Celsius.' : usedParam && (usedParam.includes('WS') || usedParam.includes('WIND')) ? 'Wind speed (m/s): average wind speed in metres per second.' : 'Measured value (units vary by parameter).'}
          </div>
        </div>
        <div className="h-56 md:h-72">
            <Line data={lineData} options={lineOptions} />
        </div>
        {/* summary below chart to aid interpretation */}
        <div className="mt-2 text-xs text-muted-foreground">Median (day 0): {Number.isFinite(medianSummary.medOfMeds) ? `${medianSummary.medOfMeds} ${unitsFor(usedParam)}` : 'n/a'} — IQR: {medianSummary.iqrCenter || 'n/a'}</div>
      </div>
      <div className="bg-card/90 p-3 rounded-lg">
        <div className="text-sm font-semibold mb-2">Distribution (±{buffer} days)</div>
        <div className="h-52 md:h-56">
          <Bar data={barData} options={{ ...barOptions, plugins: { ...barOptions.plugins, legend: { display: false } }, scales: { x: { ticks: { font: { size: 12 } } }, y: { ticks: { font: { size: 12 } } } } }} />
        </div>
      </div>
    </div>
  );
}
