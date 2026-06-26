# 🗂️ My Vault — Personal Link Directory

A Windows 95-style personal URL directory backed by Google Sheets and hosted on Vercel.
Save anything — links, places, things to buy, tools, profiles — from one URL, on any device.

---

## 📁 Project Structure

```
vault/
├── index.html        ← Full vault UI (HTML + CSS + JS)
├── api/
│   └── sheets.js     ← Vercel serverless function (talks to Google Sheets)
├── vercel.json       ← Vercel deployment config
├── .env.example      ← Template for your secret keys
├── .gitignore        ← Keeps .env out of GitHub
└── README.md         ← This file
```

---

## 🚀 Setup Guide

Follow these steps **in order**. Takes about 15–20 minutes total.

---

### STEP 1 — Create your Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new sheet
2. Rename the first tab (bottom of screen) to exactly: **`Vault`**
3. Add these headers in **Row 1**:

   | A    | B     | C   | D   | E    | F    |
   |------|-------|-----|-----|------|------|
   | id   | title | url | cat | note | date |

4. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
   ```
   Save it — you'll need it later.

---

### STEP 2 — Set up Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **"Select a project"** → **"New Project"**
3. Name it `my-vault` → click **Create**
4. Wait for it to create, then select it

---

### STEP 3 — Enable Google Sheets API

1. In Google Cloud Console, go to **APIs & Services → Library**
2. Search for **"Google Sheets API"**
3. Click it → click **Enable**

---

### STEP 4 — Create OAuth 2.0 Credentials

> This lets your vault read and write your private Google Sheet securely.

1. Go to **APIs & Services → Credentials**
2. Click **"+ Create Credentials"** → **"OAuth client ID"**
3. If prompted to configure consent screen:
   - Choose **External**
   - Fill in App name: `My Vault`
   - Fill in your email for support and developer contact
   - Click **Save and Continue** through the rest (defaults are fine)
   - On **"Test users"** step, add your own Gmail → Save
4. Back on Create OAuth client ID:
   - Application type: **Web application**
   - Name: `My Vault`
   - Under **Authorized redirect URIs**, add:
     ```
     https://developers.google.com/oauthplayground
     ```
   - Click **Create**
5. Copy and save your:
   - **Client ID** (looks like `123456789-abc.apps.googleusercontent.com`)
   - **Client Secret** (looks like `GOCSPX-xxxx`)

---

### STEP 5 — Get your Refresh Token

> A refresh token lets your serverless function get a fresh access token whenever it needs one — without you logging in every time.

1. Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. Click the ⚙️ **gear icon** (top right) → check **"Use your own OAuth credentials"**
3. Enter your **Client ID** and **Client Secret** → Close
4. In the left panel, scroll to find **"Google Sheets API v4"**
5. Expand it → check `https://www.googleapis.com/auth/spreadsheets`
6. Click **"Authorize APIs"** → sign in with your Google account → Allow
7. Click **"Exchange authorization code for tokens"**
8. Copy the **Refresh token** value — save it securely

---

### STEP 6 — Create an API Key

1. Back in Google Cloud Console → **APIs & Services → Credentials**
2. Click **"+ Create Credentials"** → **"API Key"**
3. Copy the key
4. Click **"Restrict Key"**:
   - Under **API restrictions** → select **"Restrict key"**
   - Choose **Google Sheets API**
   - Click **Save**

---

### STEP 7 — Push to GitHub

1. Create a new **public** or **private** repo on GitHub (e.g. `vault`)
2. Push all project files:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/akshobyaas/vault.git
   git push -u origin main
   ```
   > ✅ `.env` is in `.gitignore` — it will NOT be pushed

---

### STEP 8 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → sign up / log in with GitHub
2. Click **"Add New Project"**
3. Import your `vault` GitHub repo
4. Click **"Deploy"** (default settings are fine)
5. After deploy, go to your project → **Settings → Environment Variables**
6. Add each of these one by one:

   | Key | Value |
   |-----|-------|
   | `GOOGLE_SHEET_ID` | your sheet ID from Step 1 |
   | `GOOGLE_API_KEY` | your API key from Step 6 |
   | `GOOGLE_CLIENT_ID` | your client ID from Step 4 |
   | `GOOGLE_CLIENT_SECRET` | your client secret from Step 4 |
   | `GOOGLE_REFRESH_TOKEN` | your refresh token from Step 5 |

7. After adding all variables, go to **Deployments → Redeploy** (so Vercel picks up the new env vars)

---

### STEP 9 — Done! 🎉

Your vault is live at:
```
https://your-project-name.vercel.app
```

Open it from any device — phone, laptop, anywhere. All links sync instantly via Google Sheets.

---

## ⌨️ How to use the vault

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

## 🔒 Security notes

- Your API keys live in **Vercel's environment variables** — never in the code
- Your Google Sheet can be **private** — only your OAuth credentials can access it
- The `.env` file is in `.gitignore` — never pushed to GitHub
- The serverless function acts as a **middleman** — the browser never sees your keys

---

## 🔮 Future: AI Summarizer (v2)

Planned: a Claude API-powered chatbot panel where you can ask questions about your saved links.
Example: *"What AI tools have I saved?"* or *"Summarize the note on this link."*

---

## 📦 Tech stack

| Layer | Tech |
|-------|------|
| Frontend | HTML + CSS + Vanilla JS (single file) |
| Backend | Vercel Serverless Function (Node.js) |
| Database | Google Sheets (private) |
| Hosting | Vercel (free tier) |
| Fonts | VT323 via Google Fonts |
| Style | Windows 95 retro UI with emoji icons |
