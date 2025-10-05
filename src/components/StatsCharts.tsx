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

// Register necessary Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// lightweight wrapper: expects analysis with arrays for monthly values
export default function StatsCharts({ analysis }: { analysis: any }) {
  // Prefer explicitly provided monthly series: analysis.monthly or analysis.monthly_avg
  const monthly: number[] = (
    Array.isArray(analysis?.monthly) ? analysis.monthly :
    Array.isArray(analysis?.monthly_avg) ? analysis.monthly_avg :
    // fallback: try to compute monthly means if analysis.history_daily exists (date,value)
    (function computeFromDaily() {
      try {
        const daily = analysis?.history_daily;
        if (!Array.isArray(daily)) return Array.from({ length: 12 }, () => 0);
        const bins: number[] = Array.from({ length: 12 }, () => 0);
        const counts: number[] = Array.from({ length: 12 }, () => 0);
        for (const row of daily) {
          // expect { date: 'YYYY-MM-DD', value: number }
          const d = row?.date ? new Date(row.date) : (row?.ts ? new Date(row.ts * 1000) : null);
          const v = typeof row.value === 'number' ? row.value : Number(row?.val ?? NaN);
          if (!d || Number.isNaN(v)) continue;
          const m = d.getUTCMonth();
          bins[m] += v;
          counts[m] += 1;
        }
        return bins.map((s, i) => (counts[i] > 0 ? +(s / counts[i]).toFixed(2) : 0));
      } catch (e) {
        return Array.from({ length: 12 }, () => 0);
      }
    })()
  );

  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const data = {
    labels,
    datasets: [
      { label: 'Monthly avg', data: monthly, backgroundColor: 'rgba(59,130,246,0.9)' }
    ]
  };

  // compute mean for overlay
  const mean = monthly && monthly.length ? +(monthly.reduce((s, v) => s + (Number(v) || 0), 0) / monthly.length).toFixed(2) : NaN;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            return `Value: ${context.parsed.y}`;
          }
        }
      },
      title: { display: false }
    },
    scales: {
      x: { title: { display: true, text: 'Month' }, ticks: { font: { size: 12 } } },
      y: { title: { display: true, text: 'Monthly avg (units)' }, ticks: { font: { size: 12 } } }
    }
  } as any;

  return (
    <div>
      <div className="h-48 md:h-56">
        <Bar data={data} options={options} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">Mean of monthly averages: {Number.isFinite(mean) ? mean : 'n/a'}</div>
    </div>
  );
}
