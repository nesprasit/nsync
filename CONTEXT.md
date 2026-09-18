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

Built for personal use; "lightweight"; deliberately not depending on existing
third-party sync software.

### Sync scope
Syncs `.md` notes + attachments + `.obsidian/` config, but **excludes** churny
files (`workspace.json`, `workspace-mobile.json`, caches). Attachment size limit
to be decided.

### Account model
One Google account = one vault stored in that account's `appDataFolder`. Every
device signs in with the same account and sees the same vault. Single vault,
single account for v1.

Two independent layers, often confused:
- **Account (who logs in)**: always the end user's own Google account. Files land
  in that account's own appDataFolder; different users' files never mix.
- **OAuth Client ID (which "app" requests access)**: a **single** Client ID that
  the plugin author owns, embedded in the plugin (via PKCE — no client secret is
  embedded). All users authenticate through this one app. Consequence: the app is
  the author's, capped at 100 users while unverified. Sharing the Client ID does
  not mix anyone's files.

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

### Auth (decided: PKCE)
Google OAuth via PKCE — no backend, no embedded client secret. The refresh
token is the sensitive credential: stored per-device, **never** synced to Drive,
kept out of the sync scope (OS keychain on desktop where possible).

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
once (a slow but one-time pass), then asks the user to confirm before writing.

### Attachment size limit
Mobile-aware: desktop syncs all files; mobile skips files above ~50MB and shows
that the file exists on desktop only.

## Known constraints (facts, not decisions)

- Auto-sync every 60s runs only while Obsidian is open. Obsidian mobile has no
  true background execution, so mobile sync happens on app open / foreground and
  on the manual button — not silently in the background.
- Google OAuth in "Testing" publishing status expires refresh tokens after ~7
  days. Resolved by publishing the consent screen to **Production (unverified)**:
  tokens no longer expire; users pass a one-time "unverified app" warning; capped
  at 100 users (ample for personal use).

### Distribution
Personal use only. The plugin is **not** listed in the Obsidian community
directory and is installed manually from a local build. The built `main.js`
embeds the OAuth client secret, so it must never be attached to a public
GitHub release or shared. Offering the plugin to others would mean switching to
per-user OAuth credentials entered in settings.

## Open questions

_(none — design tree fully explored)_
