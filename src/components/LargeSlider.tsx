import React from 'react';

export default function LargeSlider({ value = 0 }: { value?: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="bg-gradient-to-b from-white/6 to-white/3 backdrop-blur-md p-4 rounded-2xl border border-white/6 shadow-lg">
      <div className="w-full bg-muted/60 rounded-full h-8 relative">
        <div className="absolute left-0 top-0 bottom-0 rounded-full bg-gradient-to-r from-yellow-400 via-sky-400 to-indigo-600" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between items-center mt-3 text-base font-semibold">
        <div className="text-yellow-300 text-lg">☀️ Sunny</div>
        <div className="text-sky-300 text-lg">🌥️ Gloomy</div>
        <div className="text-indigo-300 text-lg">🌧️ Rainy</div>
      </div>
    </div>
  );
}
