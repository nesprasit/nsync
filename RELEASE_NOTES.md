# NSync 0.1.0

First release. Sync an Obsidian vault across desktop and mobile through your own
Google Drive — a single plugin, no server, no third-party sync service.

## Highlights
- 🔁 Two-way sync via Google Drive `appDataFolder`
- 🖥️📱 One codebase for macOS desktop + iOS/Android
- 🔐 Google OAuth (PKCE) — sign in with your own account; files never mix
- 🧩 Conflict copies — concurrent edits never lose data
- 🪦 Shared tombstones — deletes don't resurrect on new devices
- ⏱️ Auto-sync every 60s + manual sync button
- 📵 Mobile-aware — skips files > 50MB on mobile

## Install (manual)
1. Download `main.js` and `manifest.json` below.
2. Put them in `<vault>/.obsidian/plugins/nsync/`.
3. Enable **NSync** in Settings → Community plugins.

## Setup
You need your own Google Cloud OAuth client (Web application) with the
`drive.appdata` scope. See the [README](https://github.com/nesprasit/nsync#readme)
for the full setup guide, including the mobile redirect bridge.

## Known limitations
- No real-time push (polls every 60s); no background sync on mobile.
- No end-to-end encryption yet.
