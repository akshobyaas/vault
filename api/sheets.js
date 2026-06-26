// api/sheets.js — Vercel Serverless Function
// Handles all Google Sheets CRUD. API keys stay here, never reach the browser.

const SHEET_ID      = process.env.GOOGLE_SHEET_ID;
const API_KEY       = process.env.GOOGLE_API_KEY;
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const SHEET_NAME    = 'Vault';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Get fresh OAuth access token ──
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
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

// ── Read all links ──
async function getLinks(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A2:F`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return (data.values || []).map(r => ({
    id: r[0]||'', title: r[1]||'', url: r[2]||'',
    cat: r[3]||'Other', note: r[4]||'', date: r[5]||'',
  }));
}

// ── Append new link ──
async function addLink(token, link) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[link.id, link.title, link.url, link.cat, link.note||'', link.date||new Date().toISOString()]] }),
  });
  return res.json();
}

// ── Find row number by ID ──
async function findRowById(token, id) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A:A`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const rows = data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === String(id)) return i + 1;
  }
  return null;
}

// ── Update existing link ──
async function updateLink(token, link) {
  const rowNum = await findRowById(token, link.id);
  if (!rowNum) throw new Error('Link not found: ' + link.id);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A${rowNum}:F${rowNum}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[link.id, link.title, link.url, link.cat, link.note||'', link.date||new Date().toISOString()]] }),
  });
  return res.json();
}

// ── Delete a link row ──
async function deleteLink(token, id) {
  const rowNum = await findRowById(token, id);
  if (!rowNum) throw new Error('Link not found: ' + id);
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json();
  const sheet = meta.sheets.find(s => s.properties.title === SHEET_NAME);
  const sheetId = sheet.properties.sheetId;
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum } } }]
    }),
  });
  return res.json();
}

// ── Main handler (CommonJS — works with Vercel Node out of the box) ──
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Content-Type', 'application/json');

  try {
    const token = await getAccessToken();

    if (req.method === 'GET') {
      const links = await getLinks(token);
      return res.status(200).json({ success: true, links });
    }
    if (req.method === 'POST') {
      const link = req.body;
      if (!link.title || !link.url) return res.status(400).json({ error: 'Title and URL required' });
      await addLink(token, link);
      return res.status(200).json({ success: true });
    }
    if (req.method === 'PUT') {
      const link = req.body;
      if (!link.id) return res.status(400).json({ error: 'Link ID required' });
      await updateLink(token, link);
      return res.status(200).json({ success: true });
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID required' });
      await deleteLink(token, id);
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Vault API error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
