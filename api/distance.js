// api/distance.js — Vercel Serverless Function
// Resolves a Google Maps link (full, short, or place-name) to coordinates,
// then returns car + motorcycle distance/duration from NIE North Campus.
// Routing: Valhalla (FOSSGIS public server) for both car and motorcycle, with the OSRM
// demo server as a car-only backup. Geocoding: Nominatim. No API keys required.
// None of these services know about live traffic, and they err in opposite directions:
// OSRM assumes empty roads (too fast), Valhalla uses cautious Indian speed defaults (too slow).
// We call both and report the midpoint as the estimate, with the two as a low–high range.
// Calibrated against Google Maps on one Mysuru city ride (OSRM 22, Valhalla 71, Google 44 min);
// adjust the fallback factors below if more comparisons show a consistent bias.

// NIE North Campus — precise coordinates (12°22'22.4"N 76°35'06.1"E), hardcoded to avoid
// a geocoding round-trip on every request.
const ORIGIN = { lat: 12.372889, lng: 76.585028 };

async function safeFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${url.split('?')[0]}: ${text.slice(0, 200)}`);
  }
}

async function geocode(query, biasNearOrigin) {
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  if (biasNearOrigin) {
    // Soft bias (not bounded) toward a ~100km box around NIE North Campus — prefers
    // local matches for common names without excluding a genuinely distant place.
    const d = 1.0; // roughly 100km in degrees at this latitude
    const viewbox = [ORIGIN.lng - d, ORIGIN.lat + d, ORIGIN.lng + d, ORIGIN.lat - d].join(',');
    url += `&viewbox=${viewbox}`;
  }
  const { data } = await safeFetch(url, { headers: { 'User-Agent': 'MyVault-RideDrive/1.0 (personal tool)' } });
  if (!data?.[0]) throw new Error(`Could not geocode: "${query}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), resolvedName: data[0].display_name };
}

async function reverseGeocode(lat, lng) {
  try {
    const { data } = await safeFetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'MyVault-RideDrive/1.0 (personal tool)' } }
    );
    return data?.display_name || null;
  } catch {
    return null;
  }
}

async function getOrigin() {
  return ORIGIN;
}

// Resolve a destination link (full Maps URL, short goo.gl link, or plain place name) to lat/lng
async function resolveDestination(link) {
  let target = link.trim();

  // Follow redirect if it's a short link — validated by actual hostname, not substring
  // match, so an attacker can't smuggle an internal/arbitrary URL past this check
  // (e.g. "http://internal-host/?x=maps.app.goo.gl" would pass a substring test but not this).
  let isShortLink = false;
  try {
    const u = new URL(target);
    isShortLink = (u.hostname === 'maps.app.goo.gl') ||
      (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps'));
  } catch {
    isShortLink = false; // not a valid absolute URL at all
  }
  if (isShortLink) {
    const res = await fetch(target, { method: 'GET', redirect: 'follow' });
    target = res.url;
  }

  // If it's not a URL at all, treat it as a place name/address directly
  if (!/^https?:\/\//.test(target)) {
    return await geocode(target, true);
  }

  // Prefer exact coordinates embedded in the URL — unambiguous, unlike a bare place
  // name which Nominatim will happily match to a same-named place anywhere on Earth
  // (this is what caused "Shree krishna garden" near Mysuru to resolve to an
  // unrelated "Shree Krishna" restaurant 2000km away in Gurgaon).
  let m = target.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) m = target.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); // pin-specific coords
  if (!m) m = target.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) {
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    const resolvedName = await reverseGeocode(lat, lng);
    return { lat, lng, resolvedName };
  }

  // No coordinates in the URL at all — fall back to geocoding the place name,
  // biased toward the area around NIE North Campus so common names resolve locally.
  const placeMatch = target.match(/\/maps\/place\/([^/@]+)/);
  if (placeMatch) {
    const name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    return await geocode(name, true);
  }

  // Last resort: try geocoding the raw URL text
  return await geocode(target);
}

// ── Routing ──
// Valhalla has real "auto" and "motorcycle" profiles (OSRM's public demo only has driving).
// The API response keeps the field name `bike` so existing sheet columns (bike_km / bike_min)
// keep working — it now means motorcycle.
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const OSRM_DRIVING = 'https://router.project-osrm.org/route/v1/driving';

async function fetchWithTimeout(url, opts = {}, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function routeValhalla(costing, origin, dest) {
  const body = {
    locations: [{ lat: origin.lat, lon: origin.lng }, { lat: dest.lat, lon: dest.lng }],
    costing,
    units: 'kilometers',
    directions_type: 'none',
  };
  if (costing === 'motorcycle') {
    // A road-legal motorcycle like a Hunter 350: highways fine, avoid unpaved tracks.
    body.costing_options = { motorcycle: { use_highways: 1.0, use_trails: 0.0 } };
  }
  const res = await fetchWithTimeout(VALHALLA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'MyVault-RideDrive/1.0 (personal tool)' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Valhalla returned non-JSON (${res.status})`); }
  const sum = data?.trip?.summary;
  if (!res.ok || !sum) throw new Error(data?.error || `Valhalla ${costing} routing failed (${res.status})`);
  return { distance_km: +sum.length.toFixed(2), duration_min: Math.round(sum.time / 60) };
}

async function routeOSRMDriving(origin, dest) {
  const url = `${OSRM_DRIVING}/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;
  const { data } = await safeFetch(url);
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error(`driving routing failed: ${data.code || 'unknown error'}`);
  const r = data.routes[0];
  return { distance_km: +(r.distance / 1000).toFixed(2), duration_min: Math.round(r.duration / 60) };
}

// When only one service answers, scale it toward the midpoint (from the calibration ride).
const FAST_ONLY_FACTOR = 2.0;   // OSRM time × this ≈ real time
const SLOW_ONLY_FACTOR = 0.62;  // Valhalla time × this ≈ real time

async function estimateTrip(origin, dest) {
  const [fast, slow, moto] = await Promise.allSettled([
    routeOSRMDriving(origin, dest),
    routeValhalla('auto', origin, dest),
    routeValhalla('motorcycle', origin, dest),
  ]);
  const F = fast.status === 'fulfilled' ? fast.value : null;
  const S = slow.status === 'fulfilled' ? slow.value : null;
  const M = moto.status === 'fulfilled' ? moto.value : null;

  let car = null, carError = null;
  if (F && S) {
    car = {
      distance_km: S.distance_km,  // Valhalla's route length matched Google's closely
      duration_min: Math.round((F.duration_min + S.duration_min) / 2),
      low_min: Math.min(F.duration_min, S.duration_min),
      high_min: Math.max(F.duration_min, S.duration_min),
    };
  } else if (S) {
    car = { distance_km: S.distance_km, duration_min: Math.round(S.duration_min * SLOW_ONLY_FACTOR) };
  } else if (F) {
    car = { distance_km: F.distance_km, duration_min: Math.round(F.duration_min * FAST_ONLY_FACTOR) };
  } else {
    carError = (slow.reason || fast.reason)?.message || 'Car routing failed';
  }

  // Motorcycle: same correction as the car, via Valhalla's motorcycle-vs-car time ratio.
  let bike = null, bikeError = null;
  if (M) {
    const ratio = S && S.duration_min > 0 ? M.duration_min / S.duration_min : 1;
    if (car) {
      bike = { distance_km: M.distance_km, duration_min: Math.round(car.duration_min * ratio) };
      if (car.low_min != null) {
        bike.low_min = Math.round(car.low_min * ratio);
        bike.high_min = Math.round(car.high_min * ratio);
      }
    } else {
      bike = { distance_km: M.distance_km, duration_min: Math.round(M.duration_min * SLOW_ONLY_FACTOR) };
    }
  } else {
    bikeError = moto.reason?.message || 'Motorcycle routing failed';
  }
  return { car, bike, carError, bikeError };
}

// Best-effort rate limit — resets on cold start since it's in-memory, but still helps
// during sustained abuse within a warm instance. The API key above is the real gate;
// this just protects Nominatim's usage policy (1 req/sec) from a leaked/brute-forced key.
const rateLimitLog = new Map(); // ip -> [timestamps]
function isRateLimited(ip, maxPerMinute = 20) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (rateLimitLog.get(ip) || []).filter(t => t > windowStart);
  hits.push(now);
  rateLimitLog.set(ip, hits);
  return hits.length > maxPerMinute;
}

module.exports = async function handler(req, res) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) ? origin : (ALLOWED_ORIGIN || 'null'));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Vault-Key');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const VAULT_KEY = process.env.VAULT_API_KEY;
  if (!VAULT_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: VAULT_API_KEY is not set' });
  }
  if (req.headers['x-vault-key'] !== VAULT_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests — please slow down' });
  }

  const { link } = req.body || {};
  if (!link) return res.status(400).json({ error: 'Link (or place name) required' });

  try {
    const [origin, dest] = await Promise.all([getOrigin(), resolveDestination(link)]);

    const { car, bike, carError, bikeError } = await estimateTrip(origin, dest);
    if (!car && !bike) throw new Error('Routing failed: ' + carError);

    return res.status(200).json({
      success: true,
      destination: dest.resolvedName || link,
      origin: { lat: origin.lat, lng: origin.lng },
      car, bike, carError, bikeError,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};