import React from 'react';

export default function TrendChart({ data }: { data?: number[] }) {
  if (!data || !data.length) return <div className="text-xs text-muted-foreground"></div>;
  const w = 300;
  const h = 72;
  const pad = 8;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (d - min) / range) * (h - pad * 2);
    return { x, y };
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} L ${points[points.length - 1].x} ${h - pad} L ${points[0].x} ${h - pad} Z`;

  return (
    <svg width={w} height={h} className="block mx-auto">
      <defs>
        <linearGradient id="grad2" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(99,102,241,0.25)" />
          <stop offset="100%" stopColor="rgba(99,102,241,0.03)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#grad2)" stroke="none" />
      <path d={linePath} fill="none" stroke="rgba(99,102,241,0.95)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
