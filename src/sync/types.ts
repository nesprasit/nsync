// Core sync vocabulary. Mirrors CONTEXT.md — keep the two in step.

/** One entry in the per-device sync index (see CONTEXT: "Change detection"). */
export interface IndexEntry {
  /** Vault-relative path, e.g. "notes/idea.md". */
  path: string;
  /** SHA-1 of the file content at last successful sync. Source of truth. */
  hash: string;
  /** Fast-path filter; not authoritative across platforms. */
  mtime: number;
  /** The Drive file id this local path maps to (enables rename/delete tracking). */
  remoteFileId: string;
  /** Drive's file revision/headRevisionId observed at last sync. */
  lastSyncRev: string;
}

/** Local index: path -> entry. Stored per-device, NEVER synced. */
export type SyncIndex = Record<string, IndexEntry>;

/** A tombstone marks an intentional delete so other devices don't resurrect it. */
export interface Tombstone {
  path: string;
  deletedAt: number;
  deletedBy: string; // deviceId
}

/** What one side (local or remote) looks like for a given path during reconcile. */
export interface FileState {
  path: string;
  exists: boolean;
  hash?: string; // local content hash
  mtime?: number; // local mtime (tombstone tie-breaker)
  remoteFileId?: string;
  rev?: string; // remote headRevisionId
  size?: number; // remote size in bytes
}

/** The decision the engine reaches for a single path. */
export type SyncAction =
  | { kind: "noop"; path: string }
  | { kind: "forget"; path: string } // drop a stale index entry (gone both sides)
  | { kind: "upload"; path: string; remoteFileId?: string } // create if no id, else update
  | { kind: "download"; path: string; remoteFileId: string; rev?: string; size?: number }
  | { kind: "delete-local"; path: string }
  | { kind: "delete-remote"; path: string; remoteFileId: string }
  // conflict: keep both versions. base=true  -> remote wins the canonical name,
  //           local becomes the conflict copy (converges after A syncs then B).
  //           base=false -> first-run collision, local wins, remote saved aside.
  | { kind: "conflict"; path: string; remoteFileId: string; rev?: string; base: boolean };
