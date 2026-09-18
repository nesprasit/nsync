// Groups a raw appDataFolder listing by vault namespace for display.
// Pure (no Obsidian/Drive imports) so it is unit-testable.

export interface RemoteFileLike {
  name: string;
  size?: string; // Drive returns size as a string
  modifiedTime?: string;
}

export interface RemoteEntry {
  name: string; // full remote name
  path: string; // vault path for vault files, else the full name
  size: number;
  modifiedTime?: string;
}

export interface VaultGroup {
  ns: string;
  files: RemoteEntry[];
  bytes: number;
}

export interface RemoteSummary {
  vaults: VaultGroup[];
  /** Engine metadata, e.g. m/<ns>/tombstones.json */
  meta: RemoteEntry[];
  /** Pre-namespace (v0.1.0) files not claimed by any vault. */
  legacy: RemoteEntry[];
  totalFiles: number;
  totalBytes: number;
}

export function summarizeRemote(files: RemoteFileLike[]): RemoteSummary {
  const byNs = new Map<string, VaultGroup>();
  const meta: RemoteEntry[] = [];
  const legacy: RemoteEntry[] = [];
  let totalBytes = 0;

  for (const f of files) {
    const size = f.size ? Number(f.size) : 0;
    totalBytes += size;
    const base = { name: f.name, size, modifiedTime: f.modifiedTime };

    if (f.name.startsWith("v/")) {
      const rest = f.name.slice(2);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        const ns = rest.slice(0, slash);
        let g = byNs.get(ns);
        if (!g) byNs.set(ns, (g = { ns, files: [], bytes: 0 }));
        g.files.push({ ...base, path: rest.slice(slash + 1) });
        g.bytes += size;
        continue;
      }
      legacy.push({ ...base, path: f.name }); // malformed; show rather than hide
    } else if (f.name.startsWith("m/")) {
      meta.push({ ...base, path: f.name });
    } else {
      legacy.push({ ...base, path: f.name });
    }
  }

  const byPath = (a: RemoteEntry, b: RemoteEntry) => a.path.localeCompare(b.path);
  const vaults = [...byNs.values()].sort((a, b) => a.ns.localeCompare(b.ns));
  for (const g of vaults) g.files.sort(byPath);
  meta.sort(byPath);
  legacy.sort(byPath);

  return { vaults, meta, legacy, totalFiles: files.length, totalBytes };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
