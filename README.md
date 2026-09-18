# NSync

Sync your Obsidian vaults across desktop and mobile through **your own Google
Drive**. One plugin for desktop and mobile (iOS, Android). No server, no
third-party sync service, and no one else's app in the middle: you sign in with
your own Google Cloud OAuth client.

> ⚠️ **Early software. Back up your vault before the first sync.** NSync moves
> and deletes files to keep devices in step. It has safety checks, but a backup
> is the only real undo.

---

## Features

- 🔁 **Two-way sync** between any number of devices
- 🗂️ **Many vaults, one Google account.** Each vault is kept separate on Drive
- 🔐 **Your own OAuth client.** Nothing goes through the plugin author
- 🧩 **Conflict copies.** Editing the same note on two devices keeps both versions
- 🪦 **Deletes stay deleted**, even on a device that joins later
- ✅ **Review before the first sync.** See every upload, download and delete
  before anything is written, with a warning if the vault name doesn't match
  your other devices
- 🛑 **Safety stop.** A sync that would delete most of a vault is refused
- ⏱️ **Auto-sync every 60 s** plus a manual sync button, with live progress
- 👀 **Show files on Drive.** Browse what's stored, since Drive's own UI can't
- 📵 **Mobile-aware.** Skips files over 50 MB on phones

---

## How it works

Files are stored in your Google Drive's hidden **`appDataFolder`**, which only
the OAuth client that created it can read. NSync asks for the narrow
`drive.appdata` scope and cannot see any of your other Drive files.

Each sync compares three states per file: this device, Google Drive, and the
last successful sync. From that it decides to upload, download, delete, or keep
both copies on a conflict.

### Network use

NSync connects to:

- `accounts.google.com`, `oauth2.googleapis.com` to sign in
- `www.googleapis.com` for the Google Drive API
- `nesprasit.github.io/nsync/callback.html`, **mobile sign-in only**. It's a
  static page that hands Google's sign-in code back to Obsidian. It stores
  nothing, and the code is useless without a secret that never leaves your
  device. You can host your own copy ([callback.html](callback.html)) and set
  its URL in settings.

No analytics or telemetry.

---

## Setup

You need a Google Cloud OAuth client of your own. It's free and takes about 10
minutes, once. Every device and vault can then reuse it.

### 1. Google Cloud setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   **create a project** (any name).
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. Open **Google Auth Platform** (called *OAuth consent screen* in some
   accounts).
   - **Branding:** app name (e.g. `NSync`), your support email, your developer
     contact email.
     - Home page: `https://nesprasit.github.io/nsync/`
     - Privacy policy: `https://nesprasit.github.io/nsync/privacy.html`
       (or your own pages if you host the bridge yourself).
   - **Audience:** User type **External**, then **Publish app**.
     If you stay in *Testing* instead, add your Google account under
     **Test users**, but sign-in will expire every 7 days.
   - **Data access:** **Add or remove scopes** → add
     `https://www.googleapis.com/auth/drive.appdata`.
4. **Clients → Create client**
   - Application type: **Web application**. (Other types can't register both
     redirect URIs below.)
   - **Authorised redirect URIs**, add both:
     - `http://127.0.0.1:42813`
     - `https://nesprasit.github.io/nsync/callback.html`
   - **Create**, then copy the **Client ID** and **Client secret**, or
     **download the JSON**.

> ⏳ Changes to redirect URIs can take a few minutes to a few hours to apply.
> `redirect_uri_mismatch` right after setup usually just means "wait".

### 2. Install the plugin

- **Manual install:** download `main.js` and `manifest.json` from the
  [latest release](https://github.com/nesprasit/nsync/releases) into
  `<your vault>/.obsidian/plugins/nsync/`.
- Then **Settings → Community plugins** → enable **NSync**.

### 3. Connect

1. **Settings → NSync → Google OAuth client:** paste your Client ID and Client
   secret, or paste the whole downloaded JSON into the Client ID field. Then
   **Save**. The credentials are remembered on this device for your other
   vaults.
2. **Sign in with Google.** Because the app is yours and unverified, Google
   shows *"Google hasn't verified this app"*: choose **Advanced → Go to
   (your app name)** → **Continue**.
3. Right after sign-in, NSync shows a **first-sync review**: what will be
   uploaded, downloaded and deleted. Check it, then press **Start sync**.
   Nothing is written before that. After that, sync with 🔄 in the ribbon or by
   clicking NSync in the status bar.

On a phone, **Sign in** opens a small window. Tap **Open Google sign-in**.
After you allow access, Safari/Chrome sends you back to Obsidian.

### 4. More devices and vaults

- Install NSync in the same vault on the other device, enter the same OAuth
  client, and sign in with the **same Google account**.
- Devices pair up by **Vault name on Drive** (settings). It defaults to the vault
  folder name. Make it identical on every device for the same vault.
- Each vault signs in separately, but one Google account can hold many vaults.

---

## Usage

| | |
|---|---|
| Sync now | ribbon 🔄, command *NSync: Sync now*, or click the status bar |
| Status (desktop) | status bar cloud: green = synced, spinning = syncing, red = failed |
| Browse Drive | command *NSync: Show files on Drive* |
| Auto-sync | on by default, every 60 s while Obsidian is open (settings) |

On mobile, Obsidian only runs plugins while the app is open, so syncing happens
when you open the app and when you press sync. There's no background sync.

---

## Privacy & security

- Your notes go straight between your device and **your** Google Drive.
  Nothing passes through the plugin author.
- OAuth tokens and your client secret are stored only in this vault's plugin
  data on this device. NSync never uploads them.
- Files in `appDataFolder` are not end-to-end encrypted. Google can read them,
  as with any Drive file.
- To remove everything: revoke access at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
  or Drive → Settings → Manage apps → your app → *Delete hidden app data*.

## Limitations

- No real-time push. Changes arrive on the next sync (default 60 s).
- `.obsidian` settings, themes and plugins are not synced.
- No end-to-end encryption yet.

---

## Development

```bash
npm install
npm run dev        # esbuild watch
npm run build      # typecheck + production bundle (main.js)
npm test           # unit tests (node --test + tsx)
```

```
src/
├── main.ts              plugin entry, sync scheduling, auth glue
├── settings.ts          settings tab
├── auth/                OAuth client, PKCE, desktop loopback + mobile bridge flows
├── drive/driveClient.ts Google Drive REST (appDataFolder)
├── sync/                reconcile (pure), engine, namespaces, tombstones, progress
└── ui/                  status bar, modals
```

Design notes: [CONTEXT.md](CONTEXT.md) and [docs/adr/](docs/adr/).

## License

[MIT](LICENSE)
