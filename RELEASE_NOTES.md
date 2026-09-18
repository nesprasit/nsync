# NSync 0.5.1

Sync Obsidian vaults across desktop and mobile through your own Google Drive,
using your own Google Cloud OAuth client. No server, no third-party sync
service.

> ⚠️ Early software. **Back up your vault before the first sync.**

## New in 0.5.1
- ✅ **First-sync review.** The first sync of a vault on a device shows exactly
  what will be uploaded, downloaded, and deleted, and writes nothing until you
  press *Start sync*. Auto-sync never runs a first sync by itself.
- ⚠️ Warns when this vault's name on Drive is empty but other vaults exist
  there, the usual sign of a mismatched *Vault name on Drive*.
- 🟰 Files that exist on both sides with identical content are matched instead
  of being turned into conflict copies.

## Highlights
- 🔁 Two-way sync, desktop + iOS/Android, one plugin
- 🗂️ Many vaults per Google account, kept separate by *Vault name on Drive*
- 🔐 Bring your own OAuth client. The plugin ships no credentials
- 🧩 Conflict copies, 🪦 deletes that stay deleted, 🛑 mass-delete safety stop
- ⏱️ Auto-sync every 60 s, live progress, status bar icon (desktop)
- 👀 *Show files on Drive* to browse NSync's hidden Drive folder

## Install
1. Download `main.js` and `manifest.json` below into
   `<vault>/.obsidian/plugins/nsync/`.
2. Enable **NSync** in Settings → Community plugins.
3. Follow the [setup guide](https://github.com/nesprasit/nsync#setup) to create
   your OAuth client (about 10 minutes, once).

## Known limitations
- No real-time push (syncs every 60 s); no background sync on mobile.
- `.obsidian` settings/themes/plugins are not synced.
- No end-to-end encryption yet.
