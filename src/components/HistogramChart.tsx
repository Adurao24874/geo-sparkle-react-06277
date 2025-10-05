import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// Build a simple histogram from a numeric array
function buildHistogram(values: number[], binCount = 10) {
  if (!values.length) {
    return { labels: Array.from({ length: binCount }, (_, i) => `${i + 1}`), counts: Array.from({ length: binCount }, () => 0) };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const binSize = range / binCount;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - min) / binSize)));
    counts[idx] += 1;
  }
  const labels = counts.map((_, i) => {
    const start = (min + i * binSize);
    const end = (min + (i + 1) * binSize);
    return `${start.toFixed(1)}–${end.toFixed(1)}`;
  });
  return { labels, counts };
}

export default function HistogramChart({ analysis }: { analysis: any }) {
  // Prefer a daily historical series from analysis to build a distribution
  // Try precip first, fall back to temperature or wind depending on available arrays
  let series: number[] | undefined;
  if (Array.isArray(analysis?.history_precip_mm)) series = analysis.history_precip_mm;
  else if (Array.isArray(analysis?.history_temp_c)) series = analysis.history_temp_c;
  else if (Array.isArray(analysis?.history_wind_m_s)) series = analysis.history_wind_m_s;
  else if (Array.isArray(analysis?.history_values)) series = analysis.history_values;
  else if (Array.isArray(analysis?.sparkline)) series = analysis.sparkline.map((x: any) => Number(x));
  else series = [];

  const vals = (series || []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
  const { labels, counts } = buildHistogram(vals, 10);

  const data = {
    labels,
    datasets: [
      {
        label: 'Count',
        data: counts,
        backgroundColor: 'rgba(99,102,241,0.85)',
      },
    ],
  };
  const mean = vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2) : NaN;
  const median = (() => {
    if (!vals.length) return NaN;
    const s = vals.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : +( (s[mid - 1] + s[mid]) / 2 ).toFixed(2);
  })();

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (ctx: any) => ctx[0]?.label,
          label: (ctx: any) => `Count: ${ctx.parsed.y}`,
        }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, minRotation: 0, font: { size: 12 } }, title: { display: true, text: 'Value range' } },
      y: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { stepSize: 1, font: { size: 12 } }, title: { display: true, text: 'Count' } },
    },
  } as const;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Distribution (± window) — histogram</div>
      </div>
      <div className="text-xs text-muted-foreground mb-2">
        <div><strong>X axis —</strong> Precipitation amount (mm per day) shown as bins (each label shows a range, e.g. 0–1 mm/day).</div>
        <div><strong>Y axis —</strong> Number of years in the historical sample that fell into that bin during the ± window.</div>
      </div>
      <div className="h-48 md:h-56">
        <Bar data={data} options={options} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">Median: {Number.isFinite(median) ? median : 'n/a'} • Mean: {Number.isFinite(mean) ? mean : 'n/a'}</div>
    </div>
  );
}
