import express from 'express';
import dotenv from 'dotenv';
import { fetch } from 'undici';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// Simple health
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Proxy endpoint: { url, username, password }
app.post('/api/proxy', async (req, res) => {
  const { url, username, password } = req.body || {};
  // Allow using environment variables as a fallback so server-side automation
  // can set EARTHDATA_USER / EARTHDATA_PASS instead of sending creds from the browser.
  const user = username || process.env.EARTHDATA_USER;
  const pass = password || process.env.EARTHDATA_PASS;
  if (!url) return res.status(400).json({ error: 'url is required in body' });

  try {
    // Simple in-memory cache (keyed by URL)
    const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '300', 10); // default 5 minutes
    if (!global._proxyCache) global._proxyCache = new Map();
    const cacheKey = `url:${url}`;
    const cached = global._proxyCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL * 1000) {
      return res.json({ ok: true, cached: true, ...cached.value });
    }

    // Simple per-IP rate limiting
    const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || '60', 10); // default 60 requests/min
    if (!global._rateMap) global._rateMap = new Map();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const nowMin = Math.floor(Date.now() / 60000);
    const key = `${ip}:${nowMin}`;
    const count = (global._rateMap.get(key) || 0) + 1;
    global._rateMap.set(key, count);
    if (count > RATE_LIMIT) return res.status(429).json({ error: 'rate_limited', message: 'Too many requests, slow down.' });
    const headers = {};
    // If a NASA API key is set in the environment and the URL is a NASA endpoint,
    // append it as `api_key` if it's not already present.
    const nasaKey = process.env.NASA_API_KEY;
    let fetchUrl = url;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (nasaKey && (host.endsWith('nasa.gov') || host.endsWith('eosdis.nasa.gov') || host.includes('gesdisc'))) {
        if (!parsed.searchParams.has('api_key')) {
          parsed.searchParams.set('api_key', nasaKey);
          fetchUrl = parsed.toString();
        }
      }
    } catch (e) {
      // ignore URL parse errors and use provided url
      fetchUrl = url;
    }
    if (user && pass) {
      const token = Buffer.from(`${user}:${pass}`).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
      // Also set User-Agent required by some NASA endpoints
      headers['User-Agent'] = 'nasa-opendap-proxy/0.1 (+https://example.com)';
    }

  const response = await fetch(fetchUrl, { method: 'GET', headers, maxRedirections: 5 });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return res.status(response.status).json({ error: `upstream ${response.statusText}`, details: text });
    }

    // Read a small chunk for preview (first 64KB)
    const stream = response.body;
    const reader = stream.getReader();
    let received = 0;
    const chunks = [];
    const maxBytes = 64 * 1024; // 64KB
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      chunks.push(buf);
      received += buf.length;
      if (received >= maxBytes) break;
    }

    const preview = Buffer.concat(chunks).toString('base64');
    const contentLength = response.headers.get('content-length') || null;
    const contentType = response.headers.get('content-type') || null;

    const result = { url, contentLength, contentType, previewBase64: preview, previewBytes: received };

    // Store in cache
    try {
      global._proxyCache.set(cacheKey, { ts: Date.now(), value: result });
    } catch (e) {
      // ignore cache set failures
    }

    return res.json(Object.assign({ ok: true, cached: false }, result));

  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// Serve production build (dist) or fallback to 'client' folder for dev copies.
const distDir = path.join(process.cwd(), 'dist');
const clientDir = path.join(process.cwd(), 'client');
if (fs.existsSync(distDir)) {
  // Serve static files with a short cache for assets
  app.use(express.static(distDir, { index: false, maxAge: '1d' }));

  // SPA fallback: any non-/api/* GET request should return index.html
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

} else if (fs.existsSync(clientDir)) {
  app.use('/', express.static(clientDir));
}

// Mock analysis endpoint for demo purposes
// Accepts JSON: { lat, lon, day, month, year }
app.post('/api/analyze', express.json(), (req, res) => {
  const { lat, lon, day, month, year } = req.body || {};
  if (typeof lat !== 'number' || typeof lon !== 'number' || typeof day !== 'number' || typeof month !== 'number' || typeof year !== 'number') {
    return res.status(400).json({ error: 'bad_request', message: 'lat, lon, day, month, year required (numbers)' });
  }

  // Mock algorithm: seed deterministic values based on lat/lon and day
  const seed = Math.abs(Math.floor((lat * 1000 + lon * 1000 + month * 100 + day) % 1000));
  const rand = (n) => (Math.abs(Math.sin((seed + n) * 9301) * 10000) % 100) / 100;

  const veryHot = Math.min(0.95, 0.1 + rand(1) * 0.9);
  const veryWindy = Math.min(0.9, 0.05 + rand(2) * 0.8);
  const veryWet = Math.min(0.85, 0.02 + rand(3) * 0.6);

  // Create a small sparkline (10 points) that trends slightly
  const sparkline = Array.from({ length: 10 }, (_, i) => Math.max(0, Math.min(1, 0.2 + rand(i + 10) * 0.8 - (9 - i) * 0.01)));

  const uncomfortableIndex = Math.min(1, 0.5 * veryHot + 0.3 * veryWindy + 0.2 * veryWet);

  return res.json({
    ok: true,
  location: { lat, lon },
  date: { day, month, year },
    probabilities: {
      veryHot: Math.round(veryHot * 100),
      veryWindy: Math.round(veryWindy * 100),
      veryWet: Math.round(veryWet * 100),
      uncomfortableIndex: Math.round(uncomfortableIndex * 100)
    },
    sparkline
  });
});

// Geocode endpoint using Google Maps Geocoding API (server-side, uses env var GOOGLE_MAPS_API_KEY)
app.get('/api/geocode', async (req, res) => {
  const address = req.query.address;
  if (!address) return res.status(400).json({ error: 'address query required' });
  const key = process.env.GOOGLE_MAPS_API_KEY;
  try {
    if (key) {
      // Prefer Google Geocoding when API key is available
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(String(address))}&key=${encodeURIComponent(key)}`;
      const gres = await fetch(url, { method: 'GET' });
      if (!gres.ok) return res.status(gres.status).json({ error: `geocode upstream ${gres.statusText}` });
      const j = await gres.json();
      if (!j || !j.results || j.results.length === 0) return res.status(404).json({ error: 'no_results' });
      const first = j.results[0];
      const loc = first.geometry?.location || null;
      return res.json({ ok: true, provider: 'google', formatted_address: first.formatted_address, lat: loc?.lat, lon: loc?.lng, raw: first });
    }

    // Fallback to OpenStreetMap Nominatim for developer convenience (no API key required)
    const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(String(address))}&limit=1&addressdetails=1`;
    const nres = await fetch(nomUrl, { method: 'GET', headers: { 'User-Agent': 'geo-sparkle/1.0 (dev)' } });
    if (!nres.ok) return res.status(nres.status).json({ error: `nominatim upstream ${nres.statusText}` });
    const nj = await nres.json();
    if (!nj || nj.length === 0) return res.status(404).json({ error: 'no_results' });
    const first = nj[0];
    return res.json({ ok: true, provider: 'nominatim', formatted_address: first.display_name, lat: parseFloat(first.lat), lon: parseFloat(first.lon), raw: first });

    } catch (err) {
    console.error('Error in /api/geocode:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: String(err), stack: err && err.stack ? err.stack : undefined });
  }
});

// Place autocomplete (Nominatim) — returns compact suggestions for autosuggest
app.get('/api/place-autocomplete', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'query q required' });
  try {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      // Use Google Places Autocomplete + Place Details to get coordinates
      const autoUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(String(q))}&key=${encodeURIComponent(key)}&types=geocode&language=en`;
      const autoRes = await fetch(autoUrl, { method: 'GET' });
      if (!autoRes.ok) return res.status(autoRes.status).json({ error: `google autocomplete upstream ${autoRes.statusText}` });
      const autoJ = await autoRes.json();
      const preds = (autoJ.predictions || []).slice(0, 8);
      const suggestions = [];
      for (const p of preds) {
        try {
          const placeId = p.place_id;
          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&key=${encodeURIComponent(key)}&fields=geometry,name,formatted_address,types`;
          const dres = await fetch(detailsUrl, { method: 'GET' });
          if (!dres.ok) continue;
          const dj = await dres.json();
          const r = dj.result;
          if (r && r.geometry && r.geometry.location) {
            suggestions.push({
              label: r.formatted_address || r.name || p.description || p.description,
              lat: r.geometry.location.lat,
              lon: r.geometry.location.lng,
              type: (r.types && r.types[0]) || (p.types && p.types[0]) || null,
              raw: r
            });
          }
        } catch (e) {
          // ignore per-item failures
        }
      }
      return res.json({ ok: true, suggestions });
    }

    // Fallback to Nominatim when Google key is not present
    const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(String(q))}&addressdetails=1&limit=8`;
    const r = await fetch(nomUrl, { method: 'GET', headers: { 'User-Agent': 'geo-sparkle/1.0 (dev)' } });
    if (!r.ok) return res.status(r.status).json({ error: `nominatim upstream ${r.statusText}` });
    const items = await r.json();
    // Map to a compact suggestion list
    const suggestions = (items || []).map((it) => ({
      label: it.display_name,
      lat: parseFloat(it.lat),
      lon: parseFloat(it.lon),
      type: it.type || null,
      raw: it
    }));
    return res.json({ ok: true, suggestions });
  } catch (err) {
    console.error('Error in /api/place-autocomplete:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: String(err), stack: err && err.stack ? err.stack : undefined });
  }
});

// Run Python forecasting script and return compact JSON
app.post('/api/forecast', express.json(), async (req, res) => {
  const { lat, lon, start = 2000, end = 2024, days = 7 } = req.body || {};
  // Accept several possible names for the requested forecast start date coming from the client
  const requestedDate = (req.body && (req.body.forecast_start || req.body.forecastStart || req.body.date)) || null;
  if (typeof lat !== 'number' || typeof lon !== 'number') return res.status(400).json({ error: 'lat and lon required (numbers)' });
  try {
    const spawn = (await import('child_process')).spawn;
    // Prefer explicit env, else try common Windows launcher 'py', then 'python'
    const py = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python');
    // Try to resolve script in a few common locations within this workspace
    const candidates = [
      path.join(process.cwd(), 'scripts', 'forecast_power.py'),
      path.join(process.cwd(), 'geo-sparkle-react-06277', 'scripts', 'forecast_power.py'),
    ];
    const scriptPath = candidates.find(p => fs.existsSync(p));
    if (!scriptPath) {
      return res.status(500).json({ error: 'script_not_found', message: 'Could not locate forecast_power.py', candidates });
    }
    const args = [scriptPath, '--lat', String(lat), '--lon', String(lon), '--start', String(start), '--end', String(end), '--forecast-days', String(days), '--json-out'];

    // If a client requested a specific forecast start date, forward it to the Python script
    if (requestedDate) {
      // Ensure it's a simple YYYY-MM-DD string; leave validation to the Python script which uses pandas.to_datetime
      args.push('--forecast-start', String(requestedDate));
    }

    const child = spawn(py, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeoutMs = parseInt(process.env.FORECAST_TIMEOUT_MS || '20000', 10);
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) {}
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) return res.status(500).json({ error: 'python_failed', code, stderr, stdout });
      try {
        // Be robust to extra lines before/after JSON (e.g., library warnings)
        let text = (stdout || '').trim();
        let jsonStr = null;
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = text.slice(firstBrace, lastBrace + 1);
        }
        const j = JSON.parse(jsonStr || text);
        return res.json({ ok: true, data: j });
      } catch (e) {
        return res.status(500).json({ error: 'invalid_json', stdout, stderr });
      }
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});
