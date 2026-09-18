import type { SyncAction } from "./types";

// First-sync confirmation: the first pass of a vault on a device (no index yet)
// is shown to the user before anything is written. Pure (no Obsidian imports).

export interface PlanSummary {
  upload: string[];
  download: string[];
  /** Present on both sides with no shared history: matched if identical, else conflict copy. */
  both: string[];
  deleteLocal: string[];
  deleteRemote: string[];
}

export interface FirstSyncInfo {
  namespace: string;
  localCount: number;
  remoteCount: number;
  /** Other vault namespaces found on Drive, to catch a mistyped vault name. */
  otherNamespaces: string[];
  plan: PlanSummary;
}

/** Ask only when this vault has never synced here and the pass would change something. */
export function needsFirstSyncConfirm(indexSize: number, actions: SyncAction[]): boolean {
  return indexSize === 0 && actions.some((a) => a.kind !== "noop");
}

export function summarizePlan(actions: SyncAction[]): PlanSummary {
  const s: PlanSummary = { upload: [], download: [], both: [], deleteLocal: [], deleteRemote: [] };
  for (const a of actions) {
    if (a.kind === "upload") s.upload.push(a.path);
    else if (a.kind === "download") s.download.push(a.path);
    else if (a.kind === "conflict") s.both.push(a.path);
    else if (a.kind === "delete-local") s.deleteLocal.push(a.path);
    else if (a.kind === "delete-remote") s.deleteRemote.push(a.path);
  }
  for (const list of Object.values(s)) list.sort();
  return s;
}

/**
 * A likely-mistake hint: this vault has files but its namespace on Drive is
 * empty while other vaults exist there. Returns null when nothing looks off.
 */
export function namespaceHint(info: FirstSyncInfo): string | null {
  if (info.remoteCount > 0 || info.otherNamespaces.length === 0) return null;
  const names = info.otherNamespaces.map((n) => `"${n}"`).join(", ");
  return (
    `Drive has nothing under "${info.namespace}" yet, but it does have ${names}. ` +
    `If this is the same vault as on another device, cancel and set "Vault name on Drive" to match.`
  );
}
