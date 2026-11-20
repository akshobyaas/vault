// api/sheets.js — Vercel Serverless Function
// Handles both "links" (existing Vault tab) and "prompts" (new Prompts tab)
// via a `type` query param / body field. Defaults to "links" for backward compatibility.

const crypto = require('crypto');

// Constant-time key check, so response timing can't be used to guess the key character by character.
function keyMatches(given, expected) {
  if (typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Best-effort brute-force brake: after 10 wrong keys from one IP in 15 minutes, refuse for the rest of the window.
// In-memory, so it resets on cold starts, but it makes guessing the key from one place impractical.
const failedAuth = new Map(); // ip -> [timestamps]
function tooManyFailures(ip) {
  const cutoff = Date.now() - 15 * 60_000;
  const hits = (failedAuth.get(ip) || []).filter(t => t > cutoff);
  failedAuth.set(ip, hits);
  return hits.length >= 10;
}
function recordFailure(ip) { (failedAuth.get(ip) || failedAuth.set(ip, []).get(ip)).push(Date.now()); }

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_UPLOAD_BASE64 = 4 * 1024 * 1024; // ~3 MB image; Vercel's request limit is 4.5 MB

function isWebUrl(v) {
  try { const u = new URL(String(v)); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}

// Never trust the browser: keep only plain text/number fields, cap their length, drop control characters.
// Long fields (the prompt text itself, notes) get more room than titles and tags.
const LONG_FIELDS = new Set(['prompt', 'notes', 'result']);
function cleanItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (k === 'type') continue;
    if (typeof v === 'number' && isFinite(v)) { out[k] = v; continue; }
    if (typeof v !== 'string') continue;                       // objects, arrays, booleans → dropped
    const max = LONG_FIELDS.has(k) ? 20000 : 2000;
    out[k] = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
  }
  if (out.id !== undefined && !/^[A-Za-z0-9_-]{1,40}$/.test(String(out.id))) return null;
  return out;
}

// ── Change log: every add / edit / delete / upload is recorded ──
// Always to the Vercel function log; also to a "Log" tab in your sheet if you create one
// (columns: time, action, type, id, title, ip). If the tab doesn't exist, the sheet part is skipped.
async function logChange(token, sheetId, entry) {
  console.log('[vault change]', JSON.stringify(entry));
  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Log!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[entry.at, entry.action, entry.type, entry.id, entry.title, entry.ip]] }),
    });
  } catch { /* logging must never break a save */ }
}

async function safeFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${url.split('?')[0]}: ${text.slice(0, 200)}`);
  }
}

// ── Resource config: sheet tab name, column range, row <-> object mapping ──
const RESOURCES = {
  links: {
    sheetName: 'Vault',
    range: 'A2:F',
    colRange: 'A:F',
    toRow: (o) => [
      o.id || String(Date.now()), o.title, o.url, o.cat || 'Other', o.note || '', o.date || new Date().toISOString(),
    ],
    fromRow: (r) => ({
      id: r[0] || '', title: r[1] || '', url: r[2] || '',
      cat: r[3] || 'Other', note: r[4] || '', date: r[5] || '',
    }),
    validate: (o) => o?.title && isWebUrl(o?.url),
    validationMsg: 'Title and a valid http(s) URL required',
  },
  prompts: {
    sheetName: 'Prompts',
    range: 'A2:K',
    colRange: 'A:K',
    // id, title, category, tool, tags, status, version, prompt, notes, date, result
    toRow: (o) => [
      o.id || String(Date.now()),
      o.title,
      o.category || 'Other',
      o.tool || '',
      o.tags || '',
      o.status || 'active',
      o.version || 1,
      o.prompt || '',
      o.notes || '',
      o.date || new Date().toISOString(),
      o.result || '',
    ],
    fromRow: (r) => ({
      id: r[0] || '', title: r[1] || '', category: r[2] || 'Other',
      tool: r[3] || '', tags: r[4] || '', status: r[5] || 'active',
      version: Number(r[6]) || 1, prompt: r[7] || '', notes: r[8] || '', date: r[9] || '',
      result: r[10] || '',
    }),
    validate: (o) => o?.title && o?.prompt,
    validationMsg: 'Title and Prompt text required',
  },
  rides: {
    sheetName: 'Rides',
    range: 'A2:J',
    colRange: 'A:J',
    // id, destination, link, car_km, car_min, bike_km, bike_min, date, name, tags
    toRow: (o) => [
      o.id || String(Date.now()),
      o.destination || '',
      o.link || '',
      o.car_km ?? '',
      o.car_min ?? '',
      o.bike_km ?? '',
      o.bike_min ?? '',
      o.date || new Date().toISOString(),
      o.name || '',
      o.tags || '',
    ],
    fromRow: (r) => ({
      id: r[0] || '', destination: r[1] || '', link: r[2] || '',
      car_km: r[3] || '', car_min: r[4] || '', bike_km: r[5] || '', bike_min: r[6] || '',
      date: r[7] || '', name: r[8] || '', tags: r[9] || '',
    }),
    validate: (o) => o?.link,
    validationMsg: 'Link required',
  },
};

function getResource(req) {
  const type = (req.method === 'GET' || req.method === 'DELETE')
    ? (req.query.type || 'links')
    : (req.body?.type || 'links');
  return RESOURCES[type] ? { type, cfg: RESOURCES[type] } : null;
}

module.exports = async function handler(req, res) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) ? origin : (ALLOWED_ORIGIN || 'null'));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Vault-Key');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store'); // personal data: never cache in browsers or proxies

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── API key check — everything below this line touches personal data, so it's fail-closed:
  // if VAULT_API_KEY isn't configured, requests are rejected rather than silently allowed through.
  const VAULT_KEY = process.env.VAULT_API_KEY;
  if (!VAULT_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: VAULT_API_KEY is not set' });
  }
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (tooManyFailures(clientIp)) {
    return res.status(429).json({ error: 'Too many wrong keys — try again in 15 minutes' });
  }
  if (!keyMatches(req.headers['x-vault-key'], VAULT_KEY)) {
    recordFailure(clientIp);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SHEET_ID      = process.env.GOOGLE_SHEET_ID;
  const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

  if (!SHEET_ID || !CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return res.status(500).json({
      error: 'Missing environment variables',
      missing: {
        GOOGLE_SHEET_ID:      !SHEET_ID,
        GOOGLE_CLIENT_ID:     !CLIENT_ID,
        GOOGLE_CLIENT_SECRET: !CLIENT_SECRET,
        GOOGLE_REFRESH_TOKEN: !REFRESH_TOKEN,
      }
    });
  }

  const isUpload = req.method === 'POST' && req.body?.type === 'upload';
  let type, cfg, SHEET_NAME;
  if (!isUpload) {
    const resource = getResource(req);
    if (!resource) return res.status(400).json({ error: `Unknown type. Use "links", "prompts", or "rides".` });
    ({ type, cfg } = resource);
    SHEET_NAME = cfg.sheetName;
  }

  try {
    // ── OAuth access token ──
    const { data: tokenData } = await safeFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type:    'refresh_token',
      }),
    });

    if (!tokenData.access_token) {
      // Only pass on Google's short error code, not the whole response
      return res.status(500).json({ error: 'Google sign-in failed: ' + (tokenData.error || 'unknown') });
    }
    const token = tokenData.access_token;

    // ── POST (type: 'upload') — upload an image to Drive, make it public, return its URL ──
    if (req.method === 'POST' && req.body?.type === 'upload') {
      const { filename, mimeType, data } = req.body;
      if (!data || !mimeType) return res.status(400).json({ error: 'Image data and mimeType required' });
      // Only real images, as plain base64, within the size limit. The file becomes public on Drive,
      // and mimeType goes into a multipart header, so nothing else may get through.
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) return res.status(400).json({ error: 'Only JPEG, PNG, WebP or GIF images are allowed' });
      if (typeof data !== 'string' || data.length > MAX_UPLOAD_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        return res.status(400).json({ error: 'Image is too large or not valid' });
      }
      const safeName = String(filename || `prompt-${Date.now()}`).replace(/[^\w.\- ]/g, '_').slice(0, 100);

      const boundary = 'vaultupload' + crypto.randomBytes(12).toString('hex');
      const metadata = JSON.stringify({ name: safeName, mimeType });
      const multipartBody =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        metadata + `\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        data + `\r\n` +
        `--${boundary}--`;

      const { data: uploadData } = await safeFetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );
      if (!uploadData.id) { console.error('Drive upload failed', uploadData); return res.status(500).json({ error: 'Drive upload failed' }); }

      // Make the file publicly viewable via link (required so the <img> tag can load it)
      await safeFetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });

      const url = `https://lh3.googleusercontent.com/d/${uploadData.id}`;
      await logChange(token, SHEET_ID, { at: new Date().toISOString(), action: 'upload', type: 'image', id: uploadData.id, title: safeName, ip: clientIp });
      return res.status(200).json({ success: true, url, fileId: uploadData.id });
    }


    // ── Helper: find sheet row by ID ──
    async function findRow(id) {
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:A`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const rows = data.values || [];
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === String(id)) return i + 1;
      }
      return null;
    }

    // ── GET — fetch all items of this type ──
    if (req.method === 'GET') {
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!${cfg.range}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (data.error) { console.error('Sheets read error', data.error); return res.status(500).json({ error: 'Sheets read error' }); }
      const items = (data.values || []).map(cfg.fromRow);
      return res.status(200).json({ success: true, [type]: items });
    }

    // ── POST — add new item ──
    if (req.method === 'POST') {
      const item = cleanItem(req.body);
      if (!item || !cfg.validate(item)) return res.status(400).json({ error: cfg.validationMsg });
      const row = cfg.toRow(item);
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!${cfg.colRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        }
      );
      if (data.error) { console.error('Sheets write error', data.error); return res.status(500).json({ error: 'Sheets write error' }); }
      await logChange(token, SHEET_ID, { at: new Date().toISOString(), action: 'add', type, id: String(row[0]), title: String(item.title || item.name || item.destination || '').slice(0, 100), ip: clientIp });
      return res.status(200).json({ success: true });
    }

    // ── PUT — update existing item (in place) ──
    if (req.method === 'PUT') {
      const item = cleanItem(req.body);
      if (!item?.id) return res.status(400).json({ error: 'Valid ID required' });
      if (!cfg.validate(item)) return res.status(400).json({ error: cfg.validationMsg });
      const rowNum = await findRow(item.id);
      if (!rowNum) return res.status(404).json({ error: 'Item not found' });
      const row = cfg.toRow(item);
      const lastCol = cfg.colRange.split(':')[1];
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A${rowNum}:${lastCol}${rowNum}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        }
      );
      if (data.error) { console.error('Sheets update error', data.error); return res.status(500).json({ error: 'Sheets update error' }); }
      await logChange(token, SHEET_ID, { at: new Date().toISOString(), action: 'edit', type, id: String(item.id), title: String(item.title || item.name || item.destination || '').slice(0, 100), ip: clientIp });
      return res.status(200).json({ success: true });
    }

    // ── DELETE — remove item ──
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(String(id))) return res.status(400).json({ error: 'Valid ID required' });
      const rowNum = await findRow(id);
      if (!rowNum) return res.status(404).json({ error: 'Item not found' });
      const { data: meta } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const sheet = meta.sheets?.find(s => s.properties.title === SHEET_NAME);
      if (!sheet) return res.status(500).json({ error: `Sheet tab "${SHEET_NAME}" not found` });
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ deleteDimension: { range: {
              sheetId: sheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowNum - 1,
              endIndex: rowNum,
            }}}],
          }),
        }
      );
      if (data.error) { console.error('Sheets delete error', data.error); return res.status(500).json({ error: 'Sheets delete error' }); }
      await logChange(token, SHEET_ID, { at: new Date().toISOString(), action: 'delete', type, id: String(id), title: '', ip: clientIp });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('vault api error', err);
    return res.status(500).json({ error: 'Server error — please try again' });
  }
};