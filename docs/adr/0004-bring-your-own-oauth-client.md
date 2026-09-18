# Each user brings their own Google OAuth client

**Status:** accepted. Supersedes the "one shared Client ID embedded in the
plugin" decision (CONTEXT, Q20).

To let other people use NSync, the plugin can no longer ship the author's OAuth
client: Google forces a `client_secret` for "Web application" clients, the only
type that can register both the desktop loopback and the mobile https bridge,
so embedding it would publish the secret to every user. Instead each user
creates their own Google Cloud OAuth client and enters its Client ID and secret
in settings. The bundle contains no credentials, there is no shared 100-user
cap, the author needs no Google verification, and users' tokens are issued to
their own app rather than someone else's.

## Considered options

- **Shared client, secret embedded** — rejected: the secret becomes public, and
  the author's unverified app is capped at 100 users with a warning screen.
- **Shared client + token proxy (e.g. a Cloudflare Worker holding the secret)
  + Google verification** — rejected for now: adds a server the author must
  run and trust to hold, and weeks of verification. The sign-in experience would
  be the best, so it remains the upgrade path if many non-technical users want
  NSync.
- **Bring your own client (chosen)** — no server, no secret in the bundle.

## Consequences

- One-time setup of about 10 minutes per user (README "Google Cloud setup").
- Credentials live in each vault's local plugin data and, for convenience, in
  the device's localStorage so other vaults on that device prefill them. They
  are never synced.
- Changing the Client ID signs the vault out, because tokens are bound to the
  client that issued them.
- The mobile redirect bridge page stays shared: it's static, holds nothing, and
  users can host their own and point the setting at it.
