// api/sheets.js
// Vercel Serverless Function — handles all Google Sheets CRUD operations
// This file runs on Vercel's servers, so the API key is never exposed to the browser

const SHEET_ID  = process.env.GOOGLE_SHEET_ID;
const API_KEY   = process.env.GOOGLE_API_KEY;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const SHEET_NAME = 'Vault';  // Name of the sheet tab

// ── CORS headers — allow requests from your Vercel domain ──
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Get a fresh OAuth access token using the refresh token ──
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));
  return data.access_token;
}

// ── Fetch all rows from the sheet ──
async function getLinks(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A2:F?key=${API_KEY}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const rows = data.values || [];
  return rows.map(r => ({
    id:    r[0] || '',
    title: r[1] || '',
    url:   r[2] || '',
    cat:   r[3] || 'Other',
    note:  r[4] || '',
    date:  r[5] || '',
  }));
}

// ── Append a new row ──
async function addLink(token, link) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const row = [link.id, link.title, link.url, link.cat, link.note || '', link.date || new Date().toISOString()];
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  return res.json();
}

// ── Find the row number of a link by ID ──
async function findRowById(token, id) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:A`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const rows = data.values || [];
  // Row 1 is header, data starts at row 2 → index 1
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === String(id)) return i + 1; // Sheets rows are 1-indexed
  }
  return null;
}

// ── Update an existing row ──
async function updateLink(token, link) {
  const rowNum = await findRowById(token, link.id);
  if (!rowNum) throw new Error('Link not found: ' + link.id);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A${rowNum}:F${rowNum}?valueInputOption=RAW`;
  const row = [link.id, link.title, link.url, link.cat, link.note || '', link.date || new Date().toISOString()];
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  return res.json();
}

// ── Delete a row by clearing it then shifting rows up ──
async function deleteLink(token, id) {
  const rowNum = await findRowById(token, id);
  if (!rowNum) throw new Error('Link not found: ' + id);

  // Get spreadsheet metadata to find sheet's sheetId (numeric)
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json();
  const sheet = meta.sheets.find(s => s.properties.title === SHEET_NAME);
  const sheetId = sheet.properties.sheetId;

  // Delete the row using batchUpdate
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowNum - 1,  // 0-indexed
            endIndex:   rowNum,
          },
        },
      }],
    }),
  });
  return res.json();
}

// ── Main handler ──
export default async function handler(req, res) {
  // Handle preflight CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS).end();
  }

  // Set CORS on all responses
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const token = await getAccessToken();
    const { method } = req;

    if (method === 'GET') {
      // GET /api/sheets — fetch all links
      const links = await getLinks(token);
      return res.status(200).json({ success: true, links });
    }

    if (method === 'POST') {
      // POST /api/sheets — add new link
      const link = req.body;
      if (!link.title || !link.url) return res.status(400).json({ error: 'Title and URL required' });
      await addLink(token, link);
      return res.status(200).json({ success: true });
    }

    if (method === 'PUT') {
      // PUT /api/sheets — update existing link
      const link = req.body;
      if (!link.id) return res.status(400).json({ error: 'Link ID required' });
      await updateLink(token, link);
      return res.status(200).json({ success: true });
    }

    if (method === 'DELETE') {
      // DELETE /api/sheets?id=xxx — delete a link
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Link ID required' });
      await deleteLink(token, id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Sheets API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
