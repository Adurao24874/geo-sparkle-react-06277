import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

// The Google Maps JS API key can be provided via Vite env: VITE_GOOGLE_MAPS_API_KEY
const GOOGLE_API_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';

interface Props {
  onLocate: (lat: number, lon: number, label?: string) => void;
  // optional: onAnalyze(lat, lon, label, yyyy-mm-dd)
  onAnalyze?: (lat: number | undefined, lon: number | undefined, label?: string, date?: string) => void;
}

export default function LocationForm({ onLocate, onAnalyze }: Props) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<any>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [lastLoc, setLastLoc] = useState<{ lat: number; lon: number; label?: string } | null>(null);
  const debounceRef = useRef<any>(null);
  const googleLoadedRef = useRef<boolean>(false);
  const acServiceRef = useRef<any>(null);
  const placesServiceRef = useRef<any>(null);

  // Load Google Maps JS SDK (Places library) if an API key is configured.
  // Note: we also support using Google Maps/Places REST endpoints directly when
  // VITE_GOOGLE_MAPS_API_KEY is present so the app doesn't require the local
  // backend to provide geocoding/autocomplete.
  useEffect(() => {
    if (!GOOGLE_API_KEY) return;
    if ((window as any).google && (window as any).google.maps && (window as any).google.maps.places) {
      googleLoadedRef.current = true;
      acServiceRef.current = new (window as any).google.maps.places.AutocompleteService();
      // placesService requires a DOM element; create an offscreen div
      try {
        const off = document.createElement('div');
        placesServiceRef.current = new (window as any).google.maps.places.PlacesService(off);
      } catch (e) {
        placesServiceRef.current = null;
      }
      return;
    }

    // If the SDK isn't present, still allow REST-based calls in the rest of the component.
    // We will try to load the SDK for enhanced UX, but REST fallbacks will work without it.
    const existing = document.querySelector(`script[data-google-maps]`);
    if (existing) return;
    const s = document.createElement('script');
    s.setAttribute('data-google-maps', '1');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places`;
    s.async = true;
    s.onload = () => {
      googleLoadedRef.current = true;
      try {
        acServiceRef.current = new (window as any).google.maps.places.AutocompleteService();
        const off = document.createElement('div');
        placesServiceRef.current = new (window as any).google.maps.places.PlacesService(off);
      } catch (e) {
        acServiceRef.current = null;
        placesServiceRef.current = null;
      }
    };
    s.onerror = () => {
      // if script fails to load (blocked network), we'll still rely on REST calls
      googleLoadedRef.current = false;
    };
    document.head.appendChild(s);
  }, []);

  // show a small inline hint when SDK isn't available
  const sdkAvailable = GOOGLE_API_KEY && googleLoadedRef.current;

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError(null);
    if (!address) return setError('Enter a place name or address');
    setLoading(true);
    try {
      // If Google SDK available, prefer client-side resolution
      if (sdkAvailable && acServiceRef.current) {
        acServiceRef.current.getPlacePredictions({ input: address }, (preds: any[]) => {
          if (!preds || preds.length === 0) {
            setError('No suggestions found for that address');
            setLoading(false);
            return;
          }
          const first = preds[0];
          const places = new (window as any).google.maps.places.PlacesService(document.createElement('div'));
          places.getDetails({ placeId: first.place_id }, (place: any) => {
            if (!place || !place.geometry) {
              setError('Could not resolve place details');
              setLoading(false);
              return;
            }
            const lat = place.geometry.location.lat();
            const lon = place.geometry.location.lng();
            const label = place.formatted_address || place.name || address;
            onLocate(lat, lon, label);
            setLastLoc({ lat, lon, label });
            // ensure we clear loading after callbacks
            setLoading(false);
          });
        });
        return;
      }

      // If we have a Google API key, prefer the REST Geocoding endpoint directly
      if (GOOGLE_API_KEY) {
        const gurl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(GOOGLE_API_KEY)}`;
        const gres = await fetch(gurl, { method: 'GET' });
        if (!gres.ok) {
          const txt = await gres.text().catch(() => '');
          throw new Error(`Google geocode failed: ${gres.status} ${txt}`);
        }
        const gj = await gres.json();
        if (!gj || !gj.results || gj.results.length === 0) throw new Error('No results');
        const first = gj.results[0];
        const loc = first.geometry?.location || null;
        onLocate(loc.lat, loc.lng, first.formatted_address || address);
        setLastLoc({ lat: loc.lat, lon: loc.lng, label: first.formatted_address || address });
        setLoading(false);
        return;
      }

      // If no Google key and SDK isn't loaded, we do not fall back to a local server.
      // Inform the user to provide an API key.
      throw new Error('Google Maps API key required (set VITE_GOOGLE_MAPS_API_KEY)');
    } catch (err: any) {
      setError(String(err.message || err));
      setLoading(false);
    }
  };

  // fetch suggestions (debounced). Prefer Google Places JS SDK client-side when available.
  useEffect(() => {
    if (!address || address.length < 2) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        // If Google Places SDK is loaded, use AutocompleteService
        if (GOOGLE_API_KEY && googleLoadedRef.current && acServiceRef.current) {
          acServiceRef.current.getPlacePredictions({ input: address }, (preds: any[], status: any) => {
            if (!preds || preds.length === 0) { setSuggestions([]); return setShowSuggestions(false); }
            const out = preds.map(p => ({ label: p.description, placeId: p.place_id, type: p.types && p.types[0] }));
            setSuggestions(out);
            setShowSuggestions(true);
          });
          return;
        }

        // If we have an API key but no SDK, use Google Places Autocomplete REST API
        if (GOOGLE_API_KEY) {
          // use session token to improve billing/accuracy in production; omitted here for brevity
          const autoUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(address)}&key=${encodeURIComponent(GOOGLE_API_KEY)}&types=geocode&language=en`;
          const ares = await fetch(autoUrl, { method: 'GET' });
          if (!ares.ok) { setSuggestions([]); setShowSuggestions(false); return; }
          const aj = await ares.json();
          const preds = (aj.predictions || []).slice(0, 8);
          if (!preds || preds.length === 0) { setSuggestions([]); setShowSuggestions(false); return; }
          const out = preds.map((p: any) => ({ label: p.description, placeId: p.place_id, type: p.types && p.types[0] }));
          setSuggestions(out);
          setShowSuggestions(true);
          return;
        }

        // If Google SDK isn't available and there's no API key, show no suggestions (client-only mode)
        setSuggestions([]);
        setShowSuggestions(false);
      } catch (e) {
        setSuggestions([]);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [address]);

  const pickSuggestion = (s: any) => {
    setAddress(s.label || s.description || '');
    setShowSuggestions(false);
    setLoading(true);
    // If suggestion has placeId and Google SDK is loaded, use SDK to get details
    if (s.placeId && (window as any).google && (window as any).google.maps && (window as any).google.maps.places) {
      const svc = new (window as any).google.maps.places.PlacesService(document.createElement('div'));
      svc.getDetails({ placeId: s.placeId }, (place: any) => {
        if (place && place.geometry) {
          const lat = place.geometry.location.lat();
          const lon = place.geometry.location.lng();
          const label = place.formatted_address || place.name || s.label;
          onLocate(lat, lon, label);
          setLastLoc({ lat, lon, label });
          setLoading(false);
          return;
        }
        setError('Could not resolve place details');
        setLoading(false);
      });
      return;
    }

    // If we have a placeId but no SDK, use Google Place Details REST API
    if (s.placeId && GOOGLE_API_KEY) {
      (async () => {
        try {
          const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(s.placeId)}&fields=geometry,name,formatted_address&key=${encodeURIComponent(GOOGLE_API_KEY)}`;
          const dres = await fetch(detailUrl, { method: 'GET' });
          if (!dres.ok) throw new Error(`Place details failed: ${dres.status}`);
          const dj = await dres.json();
          const result = dj.result;
          if (result && result.geometry && result.geometry.location) {
            const lat = result.geometry.location.lat;
            const lon = result.geometry.location.lng;
            const label = result.formatted_address || result.name || s.label;
            onLocate(lat, lon, label);
            setLastLoc({ lat, lon, label });
            setLoading(false);
            return;
          }
          throw new Error('No geometry returned');
        } catch (e: any) {
          setError(String(e.message || e));
          setLoading(false);
        }
      })();
      return;
    }

    // If the suggestion already contains lat/lon, use it
    if (s.lat != null && s.lon != null) {
      onLocate(s.lat, s.lon, s.label);
      setLastLoc({ lat: s.lat, lon: s.lon, label: s.label });
      setLoading(false);
      return;
    }

    // Otherwise error: we don't use server fallback. Require Google API key or SDK
    setError('Place not resolvable. Ensure VITE_GOOGLE_MAPS_API_KEY is set or the Google SDK is available.');
    setLoading(false);
  };

  // date selectors (placed beside the location input)
  const now = new Date();
  const [daySel, setDaySel] = useState<number>(now.getDate());
  const [monthSel, setMonthSel] = useState<number>(now.getMonth() + 1);
  const [yearSel, setYearSel] = useState<number>(now.getFullYear());
  const startYear = 1980;
  const endYear = now.getFullYear() + 5; // extend calendar 5 years beyond current year
  const yearOptions = Array.from({ length: (endYear - startYear + 1) }, (_, i) => startYear + i);

  // debug: log loading changes to help diagnose stuck button
  useEffect(() => {
    console.debug('LocationForm loading =>', loading);
  }, [loading]);

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-center justify-center mb-4 relative">
      <div className="relative">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter location (city, address)"
          className="p-2 rounded bg-input w-64"
          onFocus={() => { if (suggestions.length) setShowSuggestions(true); }}
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-50 left-0 right-0 bg-card border border-border mt-1 rounded max-h-44 overflow-auto">
            {suggestions.map((s, i) => (
              <li key={i} className="px-3 py-2 hover:bg-muted cursor-pointer" onMouseDown={(ev) => { ev.preventDefault(); pickSuggestion(s); }}>
                <div className="text-sm">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.type}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* date selectors beside input */}
      <div className="flex items-center gap-2">
        <select value={daySel} onChange={(e) => setDaySel(Number(e.target.value))} className="p-2 rounded bg-input text-sm">
          {Array.from({ length: 31 }, (_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
        </select>
        <select value={monthSel} onChange={(e) => setMonthSel(Number(e.target.value))} className="p-2 rounded bg-input text-sm">
          {Array.from({ length: 12 }, (_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
        </select>
        <select value={yearSel} onChange={(e) => setYearSel(Number(e.target.value))} className="p-2 rounded bg-input text-sm">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <Button type="submit" disabled={loading}>{loading ? 'Locating...' : 'Locate'}</Button>
        <Button type="button" disabled={!lastLoc} onClick={() => {
          setError(null);
          if (!lastLoc) { setError('Please locate a place first'); return; }
          if (onAnalyze) {
            const dateStr = `${yearSel}-${String(monthSel).padStart(2,'0')}-${String(daySel).padStart(2,'0')}`;
            onAnalyze(lastLoc.lat, lastLoc.lon, lastLoc.label, dateStr);
          }
        }}>Analyze</Button>
      </div>
      {error && <div className="text-sm text-red-500 ml-2">{error}</div>}
    </form>
  );
}
