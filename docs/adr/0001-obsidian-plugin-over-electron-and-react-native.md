# Build as a single Obsidian plugin, not an Electron desktop app + React Native mobile app

**Status:** accepted

The original brief was "use Electron to cover desktop and mobile." Electron
cannot target iOS/Android at all, so covering mobile would have required a
separate React Native app plus its own sync engine and editor — two codebases,
two runtimes, and (on iOS) no way for an external app to reach Obsidian mobile's
sandboxed vault. Instead we build **one Obsidian community plugin in TypeScript**:
Obsidian's own app runs the same plugin on macOS, iOS, and Android, so a single
codebase covers every platform, and the plugin reads the vault through Obsidian's
Vault API from *inside* Obsidian's sandbox, which dissolves the iOS access
problem entirely. This also matches the goal of a lightweight, self-owned tool
that doesn't depend on third-party sync software.

## Considered options

- **Electron agent (desktop) + React Native app (mobile)** — rejected: two
  codebases, and the "watch Obsidian's folder" model is impossible on iOS.
- **Standalone note app with its own editor on all platforms** — rejected: means
  rebuilding Obsidian; far more work, and abandons the real Obsidian experience.
- **Obsidian plugin (chosen)** — one codebase, all platforms, native vault access.

## Consequences

- No true background sync on mobile: Obsidian mobile runs plugins only while the
  app is open, so the 60-second auto-sync only ticks in-foreground.
- We are bound to Obsidian as the runtime and to its Plugin API's constraints
  (e.g. use `requestUrl()` for HTTP, not `fetch`).
