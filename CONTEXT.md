# Context — Obsidian-Sync

Glossary and shared language for this project. Implementation details do not belong here.

## Purpose

A file-sync system that keeps an **Obsidian vault** identical across a user's
devices, using Google Drive as the transport/storage backend and Google as the
identity provider.

## Terms

### Vault
The Obsidian vault being synced: a folder tree of `.md` notes, attachments, and
an `.obsidian/` config directory. Text-based, many small files. This is the unit
of sync.

### Sync (two-way)
An edit made on **any** device propagates to **all** other devices. Not backup,
not manual push. Implies conflict resolution is mandatory.

### appDataFolder
The hidden, app-private area of the user's Google Drive (`drive.appdata` OAuth
scope). The vault's synced copy lives here. The user does **not** see these files
in the normal Drive UI. Chosen to keep the OAuth scope narrow and avoid Google's
heavy verification.

### The Plugin
A single Obsidian community plugin written in TypeScript. It runs inside
Obsidian on **all** platforms — macOS desktop, iOS, Android — from one codebase.
It reads and writes the vault through Obsidian's Vault API (so iOS sandboxing is
a non-issue: the plugin lives inside Obsidian's own sandbox). This replaces the
earlier Electron-agent + React-Native-app design entirely.

"Lightweight", deliberately not depending on third-party sync software. Open
to anyone: each user brings their own Google OAuth client (see *OAuth client*).

### Sync scope
Syncs the vault's notes and attachments. The `.obsidian/` config folder
(settings, themes, plugins) is **not** synced today, because Obsidian's vault
file list doesn't include it. The original intent (sync config, excluding churny
files like `workspace.json`) is an open question.

### Account model
One Google account can sync **many vaults**. Each vault lives in its own
**namespace** inside that account's `appDataFolder`, so vaults never mix. Every
device signs in with the same account; each vault on each device signs in
separately.

Two independent layers, often confused:
- **Account (who logs in)**: always the user's own Google account. Files land in
  that account's own appDataFolder; different users' files never mix.
- **OAuth client (which "app" requests access)**: also the user's own (see
  *OAuth client*). `appDataFolder` is private to the client that created it, so
  every device must use the **same** OAuth client to see the same files.

### OAuth client
The user's own Google Cloud OAuth client ("bring your own credentials"), of type
*Web application* so it can register both the desktop loopback and the mobile
bridge redirect URIs. Its Client ID and secret are entered in settings, stored
only in the vault's local plugin data (and remembered in the device's
localStorage to prefill other vaults), and never bundled or synced. Changing the
Client ID signs out, since tokens belong to the client that issued them.

### Namespace
The name that pairs the same vault across devices ("Vault name on Drive" in
settings). Defaults to the vault's folder name the first time the plugin runs,
then stays pinned even if the vault is renamed. Two devices sync the same vault
only when their namespaces are identical. Changing a namespace starts a fresh
merge with the new one: nothing local is deleted because files "vanished" from
the old namespace.

### Safety stop
A sync pass that would delete more than half of the vault's tracked files
locally (and at least 5) is aborted before touching anything. That pattern
almost always means a wrong namespace or a bad remote listing, not a real mass
delete.

### Sync trigger
Manual "Sync" button + automatic sync every 60 seconds. No E2E encryption in v1
(files in appDataFolder are readable by Google, invisible to other users).

### Conflict resolution
On concurrent edits to the same file, keep **both** versions: write a conflict
copy (e.g. `note (conflict 2026-09-18 device-A).md`) rather than overwriting.
Never lose data. Requires a stored base version/hash to tell a real concurrent
edit from a normal update.

### Change detection & sync state
mtime is the fast-path filter; a content hash (e.g. SHA-1) is the source of
truth. A local index maps `path → {hash, remoteFileId, lastSyncRev}`, stored
per-device and **excluded from sync**. The `remoteFileId` link is what makes
rename/delete tracking possible.

### Auth
Google OAuth via PKCE with the user's own client, no backend. Google requires
the client secret at token exchange for web clients, so it is sent alongside
PKCE. The refresh token is the sensitive credential: stored per-device and
**never** synced to Drive.

### Delete propagation
A **tombstone** records that a file was deleted (when, by which device) so other
devices delete it too instead of resurrecting it. The actual delete is a **soft
delete** using Drive's **native trash** (`trashed = true`) rather than a
`.trash/` folder: it is recoverable (`untrash`), Google auto-purges it, and
`list()` filters it out. A retention purge may `deletePermanent` after N days.
Tombstones still drive the *local* deletion on other devices.

### First-run / initial sync
On a new device, **merge** local and remote: pull what's missing, and on
collisions apply the conflict-copy rule. An empty local vault just pulls
everything down. The first run has no index yet, so it hashes the whole vault
once (a slow but one-time pass). Asking the user to confirm before that first
write was intended but is not built yet (see open questions).

### Attachment size limit
Mobile-aware: desktop syncs all files; mobile skips files above ~50MB and shows
that the file exists on desktop only.

## Known constraints (facts, not decisions)

- Auto-sync every 60s runs only while Obsidian is open. Obsidian mobile has no
  true background execution, so mobile sync happens on app open / foreground and
  on the manual button — not silently in the background.
- Google OAuth in "Testing" publishing status expires refresh tokens after ~7
  days. Each user avoids it by publishing their own client to **Production
  (unverified)**: tokens no longer expire and they pass a one-time "unverified
  app" warning for their own app.

### Distribution
Public. The bundle contains no credentials, so releases can be shared freely;
each user sets up their own OAuth client (see ADR-0004). Installed manually from
a GitHub release for now.

## Open questions

- Confirm-before-first-sync, so a new user can't be surprised by the first write.
- Whether to sync `.obsidian/` config (and which files to exclude).
- Submitting to the Obsidian community directory (review against the plugin
  guidelines; releases must carry `main.js` + `manifest.json`).
