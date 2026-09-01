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

async function geocode(query) {
  const { data } = await safeFetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
    { headers: { 'User-Agent': 'MyVault-RideDrive/1.0 (personal tool)' } }
  );
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

  // Follow redirect if it's a short link (maps.app.goo.gl / goo.gl/maps)
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(target)) {
    const res = await fetch(target, { method: 'GET', redirect: 'follow' });
    target = res.url;
  }

  // If it's not a URL at all, treat it as a place name/address directly
  if (!/^https?:\/\//.test(target)) {
    return await geocode(target);
  }

  // Prefer an explicit place name embedded in the URL (/maps/place/NAME/) — more
  // readable and usually more accurate than reverse-geocoding raw coordinates.
  const placeMatch = target.match(/\/maps\/place\/([^/@]+)/);
  if (placeMatch) {
    const name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    try {
      return await geocode(name);
    } catch {
      // fall through to coordinate extraction below
    }
  }

  // Fall back to coords embedded in the URL, then reverse-geocode for a readable name
  let m = target.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) m = target.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); // pin-specific coords
  if (!m) m = target.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) {
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    const resolvedName = await reverseGeocode(lat, lng);
    return { lat, lng, resolvedName };
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
