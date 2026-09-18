// Per-vault namespacing inside a single Google account's appDataFolder.
// Pure helpers (no Obsidian/Drive imports) so they are unit-testable.
//
// Remote layout:
//   v/<namespace>/<vault path>        vault files
//   m/<namespace>/tombstones.json     per-vault tombstones
// Anything without a "v/" or "m/" prefix is legacy (pre-namespace, v0.1.0).

const VAULT_PREFIX = "v/";
const META_PREFIX = "m/";
export const LEGACY_TOMBSTONE_FILE = "__nsync_tombstones__.json";

export function remoteName(ns: string, path: string): string {
  return `${VAULT_PREFIX}${ns}/${path}`;
}

/** Vault path for a remote name in this namespace, or null if it belongs elsewhere. */
export function pathFromRemote(ns: string, name: string): string | null {
  const prefix = `${VAULT_PREFIX}${ns}/`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}

export function tombstoneName(ns: string): string {
  return `${META_PREFIX}${ns}/tombstones.json`;
}

export function isLegacyName(name: string): boolean {
  return !name.startsWith(VAULT_PREFIX) && !name.startsWith(META_PREFIX);
}

/** Namespaces must be non-empty and must not contain "/" (it is the separator). */
export function isValidNamespace(ns: string): boolean {
  return ns.trim().length > 0 && !ns.includes("/");
}
