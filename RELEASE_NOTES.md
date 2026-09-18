# NSync 0.6.1

First public release. NSync syncs your Obsidian vaults across desktop and mobile
through **your own Google Drive**, signing in with **your own Google Cloud OAuth
client**. No server, no third-party sync service, nothing passes through the
plugin author.

> ⚠️ Early software. **Back up your vault before the first sync.**

## New in 0.6.1
- Settings: *Choose from Google Drive* now sits on its own row under *Vault name on Google Drive* and *Apply*.

## New in 0.6.0
- **Choose from Google Drive.** In settings, pick which vault on Drive this vault syncs with from a list (file count, size, last change) instead of typing its name. Picking one opens the first-sync review right away. Works on desktop and mobile.

## New in 0.5.3
- Clears the remaining automated-review warnings (typed the desktop sign-in helper so it no longer relies on Node type definitions).

## New in 0.5.2
- Meets Obsidian's community plugin guidelines: styles moved to `styles.css`, stricter typing, clearer sentence-case UI text.
- Commands renamed: *Sync now* and *Show files on Google Drive*. If you had hotkeys on the old commands, set them again.

## Highlights
- 🔁 **Two-way sync** across desktop and iOS/Android, one plugin
- 🗂️ **Many vaults, one Google account.** Vaults are kept separate by *Vault name on Google Drive*
- 🔐 **Bring your own OAuth client.** The plugin ships no credentials
- ✅ **First-sync review.** See every upload, download and delete before anything is written
- 🧩 **Conflict copies.** Editing the same note on two devices keeps both versions; identical files are simply matched
- 🪦 **Deletes stay deleted**, even on devices that join later
- 🛑 **Safety stop** against syncs that would wipe most of a vault
- ⏱️ **Auto-sync every 60 s**, live progress, and a status bar icon on desktop
- 👀 **Show files on Google Drive** to browse NSync's hidden Drive folder

## Install
1. Download **`main.js`**, **`manifest.json`** and **`styles.css`** from the assets below.
2. Put them in `<your vault>/.obsidian/plugins/nsync/`.
3. Enable **NSync** in *Settings → Community plugins*.
4. Follow the [setup guide](https://github.com/nesprasit/nsync#setup) to create
   your Google OAuth client (about 10 minutes, once), paste it into NSync's
   settings, and sign in.

## Known limitations
- No real-time push: changes arrive on the next sync (default every 60 s).
- No background sync on mobile. It syncs while Obsidian is open.
- `.obsidian` settings, themes and plugins are not synced.
- No end-to-end encryption yet.

**Full guide:** [README](https://github.com/nesprasit/nsync#readme) ·
**Issues:** [github.com/nesprasit/nsync/issues](https://github.com/nesprasit/nsync/issues)
