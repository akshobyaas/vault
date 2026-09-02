// api/distance.js — Vercel Serverless Function
// Resolves a Google Maps link (full, short, or place-name) to coordinates,
// then returns driving + cycling distance/duration from NIE North Campus via OSRM.
// No API keys required (OSRM public demo server + Nominatim for geocoding).

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

// router.project-osrm.org's public demo only has driving data loaded — requesting
// "cycling" against it silently returns the same car route instead of erroring.
// Use OSM Germany's dedicated bike-routing server for cycling instead.
const OSRM_SERVERS = {
  driving: { base: 'https://router.project-osrm.org/route/v1/driving' },
  cycling: { base: 'https://routing.openstreetmap.de/routed-bike/route/v1/bike' },
};

async function routeOSRM(profile, origin, dest) {
  const server = OSRM_SERVERS[profile];
  const url = `${server.base}/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;
  const { data } = await safeFetch(url);
  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error(`${profile} routing failed: ${data.code || 'unknown error'}`);
  }
  const r = data.routes[0];
  return { distance_km: +(r.distance / 1000).toFixed(2), duration_min: Math.round(r.duration / 60) };
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

    const [car, bike] = await Promise.allSettled([
      routeOSRM('driving', origin, dest),
      routeOSRM('cycling', origin, dest),
    ]);

    if (car.status === 'rejected' && bike.status === 'rejected') {
      throw new Error('Both routing profiles failed: ' + car.reason.message);
    }

    return res.status(200).json({
      success: true,
      destination: dest.resolvedName || link,
      origin: { lat: origin.lat, lng: origin.lng },
      car: car.status === 'fulfilled' ? car.value : null,
      bike: bike.status === 'fulfilled' ? bike.value : null,
      carError: car.status === 'rejected' ? car.reason.message : null,
      bikeError: bike.status === 'rejected' ? bike.reason.message : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};