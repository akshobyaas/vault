// api/sheets.js — Vercel Serverless Function

// Safe JSON fetch — throws a readable error if response is HTML
async function safeFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${url.split('?')[0]}: ${text.slice(0, 200)}`);
  }
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
  const SHEET_NAME    = 'Vault';

  // ── Check all env vars present ──
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

  try {
    // ── Get OAuth access token ──
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

    // ── Helper: find sheet row by link ID ──
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

    // ── GET — fetch all links ──
    if (req.method === 'GET') {
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A2:F`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (data.error) return res.status(500).json({ error: 'Sheets read error', detail: data.error });
      const links = (data.values || []).map(r => ({
        id: r[0]||'', title: r[1]||'', url: r[2]||'',
        cat: r[3]||'Other', note: r[4]||'', date: r[5]||'',
      }));
      return res.status(200).json({ success: true, links });
    }

    // ── POST — add new link ──
    if (req.method === 'POST') {
      const link = req.body;
      if (!link?.title || !link?.url) return res.status(400).json({ error: 'Title and URL required' });
      const row = [link.id || String(Date.now()), link.title, link.url, link.cat||'Other', link.note||'', link.date||new Date().toISOString()];
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        }
      );
      if (data.error) return res.status(500).json({ error: 'Sheets write error', detail: data.error });
      return res.status(200).json({ success: true });
    }

    // ── PUT — update existing link ──
    if (req.method === 'PUT') {
      const link = req.body;
      if (!link?.id) return res.status(400).json({ error: 'ID required' });
      const rowNum = await findRow(link.id);
      if (!rowNum) return res.status(404).json({ error: 'Link not found' });
      const row = [link.id, link.title, link.url, link.cat||'Other', link.note||'', link.date||new Date().toISOString()];
      const { data } = await safeFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A${rowNum}:F${rowNum}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] }),
        }
      );
      if (data.error) return res.status(500).json({ error: 'Sheets update error', detail: data.error });
      return res.status(200).json({ success: true });
    }

    // ── DELETE — remove link ──
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID required' });
      const rowNum = await findRow(id);
      if (!rowNum) return res.status(404).json({ error: 'Link not found' });
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