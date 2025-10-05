// Minimal backend server to satisfy Vite proxy endpoints used by the app
// Implements:
//  - GET /api/place-autocomplete?q=...  -> returns { suggestions: [...] }
//  - GET /api/geocode?address=...       -> returns { ok: true, lat, lon, formatted_address, raw }

import http from 'http';
import { URL } from 'url';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

function sendJSON(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

async function nominatimSearch(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=0&limit=8`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'geo-sparkle/1.0 (+https://example.com)' } });
  if (!resp.ok) throw new Error(`Nominatim ${resp.status}`);
  const data = await resp.json();
  return data;
}

async function nominatimLookupAddress(q) {
  // re-use search but return first result
  const list = await nominatimSearch(q);
  return list[0] || null;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return sendJSON(res, {});
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (!u.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    if (u.pathname === '/api/place-autocomplete') {
      const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
      if (!q) return sendJSON(res, { suggestions: [] });
      const results = await nominatimSearch(q);
      const suggestions = results.map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon), type: r.type || r.class, raw: r }));
      return sendJSON(res, { suggestions });
    }

    if (u.pathname === '/api/geocode') {
      const address = u.searchParams.get('address') || u.searchParams.get('q') || '';
      if (!address) return sendJSON(res, { ok: false, error: 'missing address' }, 400);
      const r = await nominatimLookupAddress(address);
      if (!r) return sendJSON(res, { ok: false, error: 'no results' }, 404);
      return sendJSON(res, { ok: true, lat: Number(r.lat), lon: Number(r.lon), formatted_address: r.display_name, raw: r });
    }

    // default: echo
    sendJSON(res, { ok: false, error: 'unknown api' }, 404);
  } catch (e) {
    console.error('server error', e);
    sendJSON(res, { ok: false, error: String(e) }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Minimal API server listening on http://localhost:${PORT}`);
});
