import { useEffect, useState } from 'react';
import InteractiveGlobe, { TargetLocation } from '@/components/InteractiveGlobe';
import LocationForm from '@/components/ui/LocationForm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import AnalysisCard from '@/components/AnalysisCard';
import LargeSlider from '@/components/LargeSlider';
import StatsCharts from '@/components/StatsCharts';
import ClimatologyCharts from '@/components/ClimatologyCharts';
import HistogramChart from '@/components/HistogramChart';
import imgCloudy1 from '@/assets/cloudy (1).png';
import imgCloudy from '@/assets/cloudy.png';
import imgStorm from '@/assets/storm.png';
import imgSun from '@/assets/sun.png';

const locations: TargetLocation[] = [
  { lat: 40.7128, lon: -74.0060, label: 'New York' },
  { lat: 51.5074, lon: -0.1278, label: 'London' },
  { lat: 35.6762, lon: 139.6503, label: 'Tokyo' },
];

const Index = () => {
  const [targetLocation, setTargetLocation] = useState<TargetLocation | undefined>();
  const [loading, setLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [month, setMonth] = useState<number>(1);
  const [day, setDay] = useState<number>(1);
  const [year, setYear] = useState<number>(2025);
  const [analysis, setAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [pendingAnalyze, setPendingAnalyze] = useState<{ lat: number; lon: number; date?: string } | null>(null);
  const frames = [imgCloudy1, imgCloudy, imgStorm, imgSun];
  const [frameIdx, setFrameIdx] = useState(0);

  // Cycle images while analyzing
  useEffect(() => {
    if (!analyzing) return;
    setFrameIdx(0);
    const id = setInterval(() => {
      setFrameIdx((i) => (i + 1) % frames.length);
    }, 700);
    return () => clearInterval(id);
  }, [analyzing]);

  // TrendChart: area + line chart (SVG) for showing recent trend or forecast series
  const TrendChart = ({ data }: { data?: number[] }) => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return <div className="text-xs text-muted-foreground"></div>;
    }
    const w = 320;
    const h = 80;
    const pad = 8;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const points = data.map((d, i) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (d - min) / range) * (h - pad * 2);
      return { x, y, v: d };
    });
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} L ${points[points.length - 1].x} ${h - pad} L ${points[0].x} ${h - pad} Z`;

    return (
      <svg width={w} height={h} className="block mx-auto">
        <defs>
          <linearGradient id="grad1" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(59,130,246,0.25)" />
            <stop offset="100%" stopColor="rgba(59,130,246,0.03)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#grad1)" stroke="none" />
        <path d={linePath} fill="none" stroke="rgba(59,130,246,0.95)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* optional dots for last point */}
        {points.slice(-1).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="rgba(59,130,246,0.95)" />
        ))}
      </svg>
    );
  };

  // kept loading state in case analysis uses it; removed API proxy tester UI

  const runAnalysis = async (lat?: number, lon?: number, selectedDate?: string) => {
    console.debug('runAnalysis called', { lat, lon, selectedDate });
    if (lat == null || lon == null) return;
    setAnalysis(null);
    setAnalyzing(true);
    try {
      // Call the server-side forecast endpoint which runs the Python script and returns compact JSON
      const dateToSend = selectedDate || `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  console.debug('calling /api/forecast', { lat, lon, dateToSend });
  const endYear = Number((dateToSend || '').slice(0, 4)) || new Date().getFullYear();
  const res = await fetch('/api/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lon, start: 2000, end: endYear, days: 14, date: dateToSend, forecast_start: dateToSend, forecastStart: dateToSend }) });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        // Try to read body as text for debugging
        const text = await res.text().catch(() => '');
        setAnalysis({ error: `Server returned ${res.status}`, status: res.status, body: text });
      } else if (contentType.includes('application/json')) {
        const data = await res.json();
        // The server wraps returned Python JSON under { ok: true, data: <compact> }
        setAnalysis(data?.data || data);
      } else {
        // Received HTML or other text — show it for debugging instead of throwing
        const text = await res.text().catch(() => '');
        setAnalysis({ error: 'Non-JSON response from /api/analyze', body: text });
      }
    } catch (e) {
      setAnalysis({ error: String(e) });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
  <div className="min-h-screen flex flex-col items-start justify-start px-2 sm:px-4 pt-4 pb-12 relative overflow-hidden">
      {/* Full-page analyzing overlay */}
      {analyzing && (
        <div className="fixed inset-0 z-[1000] bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
          <img
            src={frames[frameIdx]}
            alt="Analyzing..."
            className="w-40 h-40 md:w-56 md:h-56 object-contain animate-pulse drop-shadow"
          />
          <div className="mt-4 text-gray-700 font-medium tracking-wide">Analyzing…</div>
        </div>
      )}
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      </div>

      {/* Content */}
  <div className="w-full max-w-none ml-0 mr-0 relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl md:text-7xl font-bold mb-4 bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
            Will it Rain on My Parade ?
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Explore climate signals across the globe. Click a city or locate a place to get a quick climate snapshot.
          </p>
        </div>
        {/* Charts and slider moved to the bottom of the page for full-width layout */}

        {/* Slider moved into compact card below globe per request */}

        {/* Location input form */}
        <div className="mb-6 flex justify-center">
          <LocationForm
            onLocate={(lat, lon, label) => { setTargetLocation({ lat, lon, label }); /* locate only */ }}
            onAnalyze={(lat, lon, label, date) => {
              // First: point/zoom the globe (visual focus). Do NOT start analyzing yet.
              if (lat == null || lon == null) return;
              // helper: compare with small tolerance so repeated Analyze on same spot doesn't wait for a new focus event
              const approxEq = (a?: number, b?: number, eps: number = 1e-4) => (
                typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < eps
              );

              const alreadyFocused = approxEq(targetLocation?.lat, lat) && approxEq(targetLocation?.lon, lon);
              // Always set target so globe is focused if it wasn't
              setTargetLocation({ lat, lon, label });

              if (alreadyFocused) {
                // If we're already at this location, don't wait for onFocusComplete (it won't fire). Start analysis after 2s pause.
                setPendingAnalyze(null);
                setTimeout(() => {
                  runAnalysis(lat, lon, date);
                }, 2000);
              } else {
                // Otherwise queue the analysis to start when the focus animation completes
                setPendingAnalyze({ lat, lon, date });
              }
            }}
          />
        </div>

        {/* Three-column layout: left analysis (narrow), center globe (wide), right stats (narrow) */}
  <div className="relative mb-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left analysis (col 1-3) */}
          <div className="col-span-12 lg:col-span-3 flex justify-start">
            <AnalysisCard analysis={analysis} analyzing={analyzing} />
          </div>

          {/* Center globe (col 4-9) */}
          <div className="col-span-12 lg:col-span-7 flex justify-center">
            <div className="w-full">
              <Card className="overflow-hidden border-border/50 bg-card/30 backdrop-blur-sm">
                <div className="w-full h-[680px] lg:h-[820px] flex items-center justify-center">
                  <InteractiveGlobe
                    targetLocation={targetLocation}
                    onFocusComplete={() => {
                      if (pendingAnalyze) {
                        const { lat, lon, date } = pendingAnalyze;
                        setPendingAnalyze(null);
                        // start analyzing 2s AFTER the focus animation completes
                        setTimeout(() => {
                          runAnalysis(lat, lon, date);
                        }, 2000);
                      }
                    }}
                  />
                </div>
              </Card>
            </div>
          </div>

          {/* Right stats/graphs removed from column; charts are rendered below the slider for full-width legibility */}

        </div>

        {/* Preset location buttons removed per user preference */}

        {/* Info section: place compact forecast into a 12-col grid so the slider matches globe width */}
        <div className="mt-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="hidden lg:block lg:col-span-3" />
            <div className="col-span-1 lg:col-span-7 flex justify-center">
              {analysis ? (
                <div className="w-full bg-card/90 p-4 rounded border border-border shadow-md text-left">
                 
 </div>
              ) : (
                <div className="w-full bg-card/80 p-4 rounded border border-border text-sm text-center">Enter a location to see a compact forecast.</div>
              )}
            </div>
            {/* removed right spacer so center column and right stats can expand to the viewport edge */}
          </div>
        </div>

         {/* Full-width slider row (placed at bottom): appears under the globe and above full-width charts */}
        <div className="mt-8 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12">
            <div className="hidden lg:block lg:col-span-3" />
            <div className="col-span-1 lg:col-span-7 flex items-center">
              <div className="w-full bg-card/90 p-4 rounded border border-border shadow-md">
                <LargeSlider value={analysis?.climate_risk_score ?? 0} />
              </div>
            </div>
            <div className="hidden lg:block lg:col-span-2" />
          </div>
        </div>

        {/* Full-width charts row (placed at bottom): climatology + histogram below the slider */}
        <div className="mt-6 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="col-span-1 lg:col-span-3" />
            <div className="col-span-1 lg:col-span-7">
              <div className="bg-card/90 p-4 rounded-lg border border-border shadow-sm">
                <ClimatologyCharts lat={targetLocation?.lat} lon={targetLocation?.lon} targetDate={analysis?.forecast_date} buffer={3} startYear={2000} endYear={new Date().getFullYear()} param={'PRECTOT'} />
              </div>
            </div>
            <div className="col-span-1 lg:col-span-2">
              
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
