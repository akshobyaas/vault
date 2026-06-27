# 🗂️ My Vault — Personal Link Directory

> A Windows 95-style personal URL directory backed by Google Sheets and hosted on Vercel.  
> Save links, places, tools, profiles — anything with a URL — from any device, all in one place.

![Windows 95 UI](https://img.shields.io/badge/UI-Windows%2095-008080?style=flat-square)
![Hosted on Vercel](https://img.shields.io/badge/Hosted-Vercel-black?style=flat-square&logo=vercel)
![Powered by Google Sheets](https://img.shields.io/badge/DB-Google%20Sheets-34a853?style=flat-square&logo=google-sheets)

---

## ✨ Features

- 🖥️ Retro Windows 95 desktop UI with draggable-feel icons
- 📁 Organize links into custom categories (folders in the sidebar)
- 🔍 Real-time search across all saved links
- 📝 Add titles, URLs, categories, and notes to each entry
- 🔄 Syncs instantly with your private Google Sheet
- 📱 Works on any device — phone, tablet, laptop
- 🔒 Your data stays in your own Google Sheet — no third-party database

---

## 📁 Project Structure

```
vault/
├── index.html        ← Full vault UI (HTML + CSS + Vanilla JS)
├── api/
│   └── sheets.js     ← Vercel serverless function (Google Sheets proxy)
├── vercel.json       ← Vercel deployment config
├── .env.example      ← Template for environment variables
├── .gitignore        ← Keeps .env out of GitHub
└── README.md         ← You are here
```

---

## 🚀 Setup Guide

Total time: ~15–20 minutes. Follow steps in order.

---

### Step 1 — Create your Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Rename the first tab (bottom of screen) to exactly: **`Vault`**
3. Add these headers in **Row 1**:

   | A  | B     | C   | D   | E    | F    |
   |----|-------|-----|-----|------|------|
   | id | title | url | cat | note | date |

4. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
   ```
   Save it — you'll need it in Step 8.

---

### Step 2 — Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project → New Project**
3. Name it `my-vault` → click **Create**
4. Select the new project once it's ready

---

### Step 3 — Enable Google Sheets API

1. Go to **APIs & Services → Library**
2. Search for **Google Sheets API**
3. Click it → click **Enable**

---

### Step 4 — Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. If prompted to configure a consent screen:
   - Choose **External**
   - Fill in App name: `My Vault` and your email
   - Click through the rest with defaults
   - On the **Test users** step, add your Gmail → Save
4. Back on the OAuth client ID screen:
   - Application type: **Web application**
   - Name: `My Vault`
   - Under **Authorized redirect URIs**, add:
     ```
     https://developers.google.com/oauthplayground
     ```
   - Click **Create**
5. Save your **Client ID** and **Client Secret**

---

### Step 5 — Get a Refresh Token

1. Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. Click the ⚙️ gear icon (top right) → check **Use your own OAuth credentials**
3. Enter your **Client ID** and **Client Secret** → close
4. In the left panel, find **Google Sheets API v4**
5. Check `https://www.googleapis.com/auth/spreadsheets` → click **Authorize APIs**
6. Sign in with your Google account → Allow
7. Click **Exchange authorization code for tokens**
8. Copy the **Refresh token** — save it securely

---

### Step 6 — Create an API Key

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → API Key**
3. Copy the key
4. Click **Restrict Key**:
   - Under API restrictions, select **Google Sheets API**
   - Click **Save**

---

### Step 7 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New Project** → import your `vault` repo
3. Click **Deploy** (default settings are fine)
4. After deploy, go to **Settings → Environment Variables**
5. Add each variable:

   | Variable | Value |
   |----------|-------|
   | `GOOGLE_SHEET_ID` | Sheet ID from Step 1 |
   | `GOOGLE_API_KEY` | API key from Step 6 |
   | `GOOGLE_CLIENT_ID` | Client ID from Step 4 |
   | `GOOGLE_CLIENT_SECRET` | Client Secret from Step 4 |
   | `GOOGLE_REFRESH_TOKEN` | Refresh token from Step 5 |

6. Go to **Deployments → Redeploy** so Vercel picks up the new variables

---

### Step 8 — Done 🎉

Your vault is live at:
```
https://your-project-name.vercel.app
```

Bookmark it, add it to your home screen, and save away.

---

## ⌨️ How to Use

| Action | How |
|--------|-----|
| Add a link | Click **📄 New Link** or press `Ctrl+N` |
| Open a link | Double-click its icon |
| Copy URL | Right-click → 📋 Copy URL |
| Edit a link | Right-click → ✏️ Edit |
| Delete a link | Right-click → 🗑️ Delete |
| Filter by category | Click a folder in the left sidebar |
| Search | Type in the search bar (real-time) |
| Refresh from Sheets | Click **🔄 Refresh** |

---

## 🔒 Security

- All API keys live in **Vercel environment variables** — never in the source code
- Your Google Sheet can be **private** — only your OAuth credentials can access it
- The `.env` file is in `.gitignore` and will never be pushed to GitHub
- The serverless function acts as a **middleman** — the browser never sees your keys

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | HTML + CSS + Vanilla JS (single file) |
| Backend | Vercel Serverless Function (Node.js) |
| Database | Google Sheets (private) |
| Hosting | Vercel (free tier) |
| Fonts | VT323 via Google Fonts |
| Style | Windows 95 retro UI |

---

## 🔮 Planned (v2)

- Claude AI panel — ask questions about your saved links (*"What tools have I saved?"*)
- Bulk import from browser bookmarks
- Link thumbnails / favicons

---

## 📄 License

MIT — do whatever you want with it.