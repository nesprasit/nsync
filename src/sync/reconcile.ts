import type { FileState, SyncAction, SyncIndex, Tombstone } from "./types";

// Pure three-state reconciliation, deliberately free of Obsidian/Drive imports
// so it is fully unit-testable. Given the last-synced base (index), the current
// local scan, the current remote listing, and a tombstone lookup, it returns
// the actions to apply.
//
// Truth table (L = local, R = remote, B = base/index):
//   no base + L & R            -> conflict (base:false; local stays canonical)
//   no base + L only           -> upload (unless a tombstone >= file mtime -> delete-local)
//   no base + R only           -> download
//   L & R both changed vs base -> conflict (base:true; remote wins canonical)
//   only L changed             -> upload
//   L changed but R deleted    -> upload (re-create; never lose the edit)
//   only R changed             -> download
//   L deleted but R changed    -> download (resurrect the remote edit)
//   L deleted, R unchanged     -> delete-remote
//   R deleted, L unchanged     -> delete-local
//   deleted both sides         -> forget (drop stale index)
//   nothing changed            -> noop

export function planSync(
  idx: SyncIndex,
  local: Map<string, FileState>,
  remote: Map<string, FileState>,
  getTombstone: (path: string) => Tombstone | undefined,
): SyncAction[] {
  const actions: SyncAction[] = [];
  const paths = new Set([...local.keys(), ...remote.keys(), ...Object.keys(idx)]);

  for (const path of paths) {
    const B = idx[path];
    const L = local.get(path);
    const R = remote.get(path);
    const lc = !!L && (!B || L.hash !== B.hash); // local changed
    const rc = !!R && (!B || R.rev !== B.lastSyncRev); // remote changed
    const ld = !L && !!B; // deleted locally
    const rd = !R && !!B; // deleted remotely

    if (!B) {
      if (L && R) {
        actions.push({ kind: "conflict", path, remoteFileId: R.remoteFileId!, rev: R.rev, base: false });
      } else if (L) {
        const t = getTombstone(path);
        if (t && t.deletedAt >= (L.mtime ?? 0)) {
          actions.push({ kind: "delete-local", path });
        } else {
          actions.push({ kind: "upload", path });
        }
      } else if (R) {
        actions.push({ kind: "download", path, remoteFileId: R.remoteFileId!, rev: R.rev, size: R.size });
      }
      continue;
    }

    if (lc && rc) {
      actions.push({ kind: "conflict", path, remoteFileId: R!.remoteFileId!, rev: R!.rev, base: true });
    } else if (lc && !rc && R) {
      actions.push({ kind: "upload", path, remoteFileId: B.remoteFileId });
    } else if (lc && rd) {
      actions.push({ kind: "upload", path });
    } else if (!lc && rc && L) {
      actions.push({ kind: "download", path, remoteFileId: R!.remoteFileId!, rev: R!.rev, size: R!.size });
    } else if (ld && rc) {
      actions.push({ kind: "download", path, remoteFileId: R!.remoteFileId!, rev: R!.rev, size: R!.size });
    } else if (ld && !rc && R) {
      actions.push({ kind: "delete-remote", path, remoteFileId: R.remoteFileId! });
    } else if (!lc && rd && L) {
      actions.push({ kind: "delete-local", path });
    } else if (ld && rd) {
      actions.push({ kind: "forget", path });
    } else {
      actions.push({ kind: "noop", path });
    }
  }
  return actions;
}
