// api/sheets.js — Vercel Serverless Function
// Handles both "links" (existing Vault tab) and "prompts" (new Prompts tab)
// via a `type` query param / body field. Defaults to "links" for backward compatibility.

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
    validate: (o) => o?.title && o?.url,
    validationMsg: 'Title and URL required',
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
    range: 'A2:H',
    colRange: 'A:H',
    // id, destination, link, car_km, car_min, bike_km, bike_min, date
    toRow: (o) => [
      o.id || String(Date.now()),
      o.destination || '',
      o.link || '',
      o.car_km ?? '',
      o.car_min ?? '',
      o.bike_km ?? '',
      o.bike_min ?? '',
      o.date || new Date().toISOString(),
    ],
    fromRow: (r) => ({
      id: r[0] || '', destination: r[1] || '', link: r[2] || '',
      car_km: r[3] || '', car_min: r[4] || '', bike_km: r[5] || '', bike_min: r[6] || '',
      date: r[7] || '',
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

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
      return res.status(500).json({ error: 'OAuth failed', detail: tokenData });
    }
    const token = tokenData.access_token;

    // ── POST (type: 'upload') — upload an image to Drive, make it public, return its URL ──
    if (req.method === 'POST' && req.body?.type === 'upload') {
      const { filename, mimeType, data } = req.body;
      if (!data || !mimeType) return res.status(400).json({ error: 'Image data and mimeType required' });

      const boundary = 'vaultupload' + Date.now();
      const metadata = JSON.stringify({ name: filename || `prompt-${Date.now()}`, mimeType });
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
      if (!uploadData.id) return res.status(500).json({ error: 'Drive upload failed', detail: uploadData });

      // Make the file publicly viewable via link (required so the <img> tag can load it)
      await safeFetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });

      const url = `https://lh3.googleusercontent.com/d/${uploadData.id}`;
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
      if (data.error) return res.status(500).json({ error: 'Sheets read error', detail: data.error });
      const items = (data.values || []).map(cfg.fromRow);
      return res.status(200).json({ success: true, [type]: items });
    }

    // ── POST — add new item ──
    if (req.method === 'POST') {
      const item = req.body;
      if (!cfg.validate(item)) return res.status(400).json({ error: cfg.validationMsg });
      const row = cfg.toRow(item);
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!${cfg.colRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        }
      );
      if (data.error) return res.status(500).json({ error: 'Sheets write error', detail: data.error });
      return res.status(200).json({ success: true });
    }

    // ── PUT — update existing item (in place) ──
    if (req.method === 'PUT') {
      const item = req.body;
      if (!item?.id) return res.status(400).json({ error: 'ID required' });
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
      if (data.error) return res.status(500).json({ error: 'Sheets update error', detail: data.error });
      return res.status(200).json({ success: true });
    }

    // ── DELETE — remove item ──
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID required' });
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
      if (data.error) return res.status(500).json({ error: 'Sheets delete error', detail: data.error });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};