# 🗂️ My Vault — Personal Link & Prompt Directory

> A Windows 95-style personal directory backed by Google Sheets and hosted on Vercel.  
> Save links, places, tools, profiles — anything with a URL — and keep an organized library of AI prompts alongside their outputs. All from any device, all in one place.

![Windows 95 UI](https://img.shields.io/badge/UI-Windows%2095-008080?style=flat-square)
![Hosted on Vercel](https://img.shields.io/badge/Hosted-Vercel-black?style=flat-square&logo=vercel)
![Powered by Google Sheets](https://img.shields.io/badge/DB-Google%20Sheets-34a853?style=flat-square&logo=google-sheets)

---

## ✨ Features

**Links mode**
- 🖥️ Retro Windows 95 desktop UI
- 📁 Organize links into custom categories (folders in the sidebar)
- 🔍 Real-time search across all saved links
- 📝 Add titles, URLs, categories, and notes to each entry

**Prompt Vault mode**
- 🔗📝 Win95-style tab switcher to flip between **Links** and **Prompts**
- 💾 Store prompts with category, tool, tags, status, and notes
- 🔁 **Save as New Version** — keeps prior versions on record and bumps the version number instead of overwriting
- 📋 One-click copy-to-clipboard for any prompt
- 🖼️ Thumbnail rendering when a prompt's result is an image URL
- ☁️ Upload result images straight to Google Drive (client-side resized, then hosted via Drive)

**Everywhere**
- 🔄 Syncs instantly with your private Google Sheet
- 📱 Responsive across phone, tablet, and desktop, with device-specific interactions (long-press on mobile, right-click context menu on desktop)
- 🔒 Your data stays in your own Google Sheet — no third-party database

---

## 📁 Project Structure

```
vault/
├── index.html        ← Full app UI — Links + Prompt Vault (HTML + CSS + Vanilla JS)
├── api/
│   └── sheets.js     ← Vercel serverless function (Google Sheets + Drive proxy)
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

Your sheet needs **two tabs**. Tab names are case-sensitive.

**Tab 1 — `Vault`** (for links). Add these headers in **Row 1**:

| A  | B     | C   | D   | E    | F    |
|----|-------|-----|-----|------|------|
| id | title | url | cat | note | date |

**Tab 2 — `Prompts`** (for the Prompt Vault). Add these headers in **Row 1**:

| A  | B     | C        | D    | E    | F      | G       | H      | I     | J    | K      |
|----|-------|----------|------|------|--------|---------|--------|-------|------|--------|
| id | title | category | tool | tags | status | version | prompt | notes | date | result |

Copy the **Sheet ID** from the URL:
```
https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
```
Save it as the bare ID string (not the full URL) — you'll need it in Step 7.

---

### Step 2 — Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project → New Project**
3. Name it `my-vault` → click **Create**
4. Select the new project once it's ready

---

### Step 3 — Enable APIs

Both of these need to be enabled for the app to work:

1. Go to **APIs & Services → Library**
2. Search for **Google Sheets API** → click it → click **Enable**
3. Search for **Google Drive API** → click it → click **Enable** *(needed for the Prompt Vault's image upload feature)*

---

### Step 4 — Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. If prompted to configure a consent screen:
   - Choose **External**
   - Fill in App name: `My Vault` and your email
   - Click through the rest with defaults
   - On the **Test users** step, add your Gmail → Save
   - **Publish the app** when you're done setting up (see note below) — while it's in "Testing" mode, refresh tokens expire every 7 days
4. Back on the OAuth client ID screen:
   - Application type: **Web application**
   - Name: `My Vault`
   - Under **Authorized redirect URIs**, add:
     ```
     https://developers.google.com/oauthplayground
     ```
   - Click **Create**
5. Save your **Client ID** and **Client Secret**

> ⚠️ **Testing vs Published:** OAuth consent screens left in "Testing" mode issue refresh tokens that silently expire after 7 days, which will eventually break your deployment with `invalid_grant` errors. Publish the consent screen (from the OAuth consent screen page) to get a long-lived refresh token.

---

### Step 5 — Get a Refresh Token

1. Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. Click the ⚙️ gear icon (top right) → check **Use your own OAuth credentials**
3. Enter your **Client ID** and **Client Secret** → close
4. In the left panel, select these two scopes:
   - **Google Sheets API v4** → `https://www.googleapis.com/auth/spreadsheets`
   - **Google Drive API v3** → `https://www.googleapis.com/auth/drive.file`
5. Click **Authorize APIs**
6. Sign in with your Google account → Allow
7. Click **Exchange authorization code for tokens**
8. Copy the **Refresh token** — save it securely

---

### Step 6 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New Project** → import your `vault` repo
3. Click **Deploy** (default settings are fine)
4. After deploy, go to **Settings → Environment Variables**
5. Add each variable:

   | Variable | Value |
   |----------|-------|
   | `GOOGLE_SHEET_ID` | Sheet ID from Step 1 (bare ID string, not the full URL) |
   | `GOOGLE_CLIENT_ID` | Client ID from Step 4 |
   | `GOOGLE_CLIENT_SECRET` | Client Secret from Step 4 |
   | `GOOGLE_REFRESH_TOKEN` | Refresh token from Step 5 |

6. Go to **Deployments → Redeploy** so Vercel picks up the new variables

---

### Step 7 — Done 🎉

Your vault is live at:
```
https://your-project-name.vercel.app
```

Bookmark it, add it to your home screen, and save away.

---

## ⌨️ How to Use

**Links mode**

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

**Prompt Vault mode**

| Action | How |
|--------|-----|
| Switch modes | Use the **Links / Prompts** tabs at the top |
| Add a prompt | Click **New Prompt**, fill in category/tool/tags/status/prompt/notes |
| Copy a prompt | Click the copy icon on a prompt card |
| Edit a prompt | Right-click → ✏️ Edit |
| Save a revision | Edit the prompt, then **🔁 Save as New Version** — the old version is kept and the version number bumps |
| Attach a result image | Upload an image in the prompt modal — it's resized client-side and hosted on Google Drive |

---

## 🔒 Security

- All API keys and tokens live in **Vercel environment variables** — never in the source code
- Your Google Sheet can be **private** — only your OAuth credentials can access it
- The `.env` file is in `.gitignore` and will never be pushed to GitHub
- The serverless function acts as a **middleman** — the browser never sees your credentials
- Uploaded images are stored in your own Google Drive; the serverless function makes each uploaded file `reader/anyone` so it can be displayed, but nothing else in your Drive is exposed

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | HTML + CSS + Vanilla JS (single file) |
| Backend | Vercel Serverless Function (Node.js) |
| Database | Google Sheets — private, two tabs (`Vault`, `Prompts`) |
| Image hosting | Google Drive API (for Prompt Vault result images) |
| Hosting | Vercel (free tier) |
| Fonts | VT323 via Google Fonts |
| Style | Windows 95 retro UI |

---

## 🔮 Planned (v2)

- Claude API-powered chatbot summarizer — ask questions about your saved links and prompts
- Bulk import from browser bookmarks
- Link thumbnails / favicons

---

## 📄 License

MIT — do whatever you want with it.
