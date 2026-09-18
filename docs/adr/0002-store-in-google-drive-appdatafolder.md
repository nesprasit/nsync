# Store the synced vault in Google Drive appDataFolder, not a user-visible folder

**Status:** accepted

The vault's synced copy lives in Google Drive's hidden **`appDataFolder`** (OAuth
scope `drive.appdata`) rather than in a normal folder the user can browse in the
Drive UI. The purpose of this system is to keep devices in sync, not to let users
open notes through Drive directly, so the loss of visibility costs us little. In
return, the OAuth scope stays narrow, which keeps the app out of Google's heavy
security assessment required for broad `drive`/`drive.file` access.

## Considered options

- **User-visible Drive folder** (`drive.file` or `drive`) — rejected: broader
  scope, triggers expensive/slow Google verification, and invites users to edit
  files out-of-band and create conflicts the sync engine didn't originate.
- **appDataFolder (chosen)** — narrow scope, lighter verification path, files
  isolated from manual tampering.

## Consequences

- Users cannot see or recover the synced files through the Drive web UI; recovery
  must come from the plugin (hence the soft-delete `.trash/` retention).
- Each Google account's `appDataFolder` is per-app and per-account, so files
  never mix between users even though all users share one OAuth Client ID.
