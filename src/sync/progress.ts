import type { SyncAction } from "./types";

// Progress reporting for a sync pass. Pure (no Obsidian imports) so the text
// the user sees is unit-testable.

export type SyncPhase = "listing" | "scanning" | "applying";

export interface SyncProgress {
  phase: SyncPhase;
  done: number;
  total: number;
  /** Only while applying. */
  action?: SyncAction["kind"];
  path?: string;
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: number;
}

export function emptyResult(): SyncResult {
  return { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0 };
}

export function tally(r: SyncResult, kind: SyncAction["kind"]): void {
  if (kind === "upload") r.uploaded++;
  else if (kind === "download") r.downloaded++;
  else if (kind === "delete-local") r.deletedLocal++;
  else if (kind === "delete-remote") r.deletedRemote++;
  else if (kind === "conflict") r.conflicts++;
}

const VERB: Record<SyncAction["kind"], string> = {
  upload: "uploading",
  download: "downloading",
  "delete-local": "deleting",
  "delete-remote": "deleting on Drive",
  conflict: "saving conflict copy",
  forget: "cleaning up",
  noop: "",
};

/** One-line status. withPath adds the current file (for notices, not the status bar). */
export function progressText(p: SyncProgress, withPath = false): string {
  switch (p.phase) {
    case "listing":
      return "checking Google Drive…";
    case "scanning":
      return `scanning ${p.done}/${p.total}`;
    case "applying": {
      const base = `${p.action ? VERB[p.action] : "syncing"} ${p.done}/${p.total}`;
      return withPath && p.path ? `${base}\n${p.path}` : base;
    }
  }
}

export function summaryText(r: SyncResult): string {
  const parts: string[] = [];
  if (r.uploaded) parts.push(`↑${r.uploaded} uploaded`);
  if (r.downloaded) parts.push(`↓${r.downloaded} downloaded`);
  const deleted = r.deletedLocal + r.deletedRemote;
  if (deleted) parts.push(`${deleted} deleted`);
  if (r.conflicts) parts.push(`${r.conflicts} conflict${r.conflicts > 1 ? "s" : ""}`);
  return parts.length ? parts.join(" · ") : "up to date";
}
