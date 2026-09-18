import { type App, Platform } from "obsidian";
import type { DriveClient, DriveFile } from "../drive/driveClient";
import type { IndexStore } from "./indexStore";
import type { FileState, SyncAction } from "./types";
import { TombstoneStore } from "./tombstones";
import { massDeleteReason, planSync } from "./reconcile";
import {
  LEGACY_TOMBSTONE_FILE,
  isLegacyName,
  pathFromRemote,
  remoteName,
  tombstoneName,
} from "./namespace";
import { sha1 } from "./hash";
import { emptyResult, tally, type SyncProgress, type SyncResult } from "./progress";
import { needsFirstSyncConfirm, summarizePlan, type FirstSyncInfo } from "./firstSync";
import { summarizeRemote } from "./remoteSummary";

export type ProgressFn = (p: SyncProgress) => void;
/** Asked before the first write of a never-synced vault; resolve false to cancel. */
export type ConfirmFirstSync = (info: FirstSyncInfo) => Promise<boolean>;

export type SyncOutcome =
  | { kind: "done"; result: SyncResult }
  | { kind: "cancelled" } // first sync declined; nothing was written
  | { kind: "busy" }; // another pass is already running

// Three-state reconciliation: local (L) vs remote (R) vs last-synced base (the
// index, B). Decisions follow CONTEXT.md:
//   - both changed since base          -> conflict copy (never lose data)
//   - only one side changed            -> propagate that side
//   - deleted on one side              -> soft-delete the other + tombstone
//   - new device sees a tombstone      -> honour the delete, don't resurrect

const MOBILE_MAX_BYTES = 50 * 1024 * 1024; // CONTEXT Q18: mobile skips > ~50MB

/**
 * Paths that must never be synced. The config folder (vault.configDir, usually
 * .obsidian) needs no entry: Obsidian's vault file list never includes it.
 */
const EXCLUDES = [".trash/"];

export function isExcluded(path: string): boolean {
  return EXCLUDES.some((e) => (e.endsWith("/") ? path.startsWith(e) : path === e));
}

export class SyncEngine {
  private running = false;
  private readonly tombstones: TombstoneStore;

  constructor(
    private readonly app: App,
    private readonly drive: DriveClient,
    private readonly store: IndexStore,
  ) {
    this.tombstones = new TombstoneStore(drive);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Entry point for both the manual button and the 60s timer. Non-reentrant:
   * returns "busy" without doing anything if a pass is already running.
   * @param confirmFirst consulted before the first write of a vault that has
   *   never synced on this device; omitted means "proceed".
   */
  async sync(
    onProgress: ProgressFn = () => {},
    confirmFirst?: ConfirmFirstSync,
  ): Promise<SyncOutcome> {
    if (this.running) return { kind: "busy" }; // sync lock: never run two passes at once
    this.running = true;
    try {
      const ns = this.store.namespace;
      onProgress({ phase: "listing", done: 0, total: 0 });
      let remoteFiles = await this.drive.list();
      if (this.store.needsLegacyMigration) {
        await this.migrateLegacy(remoteFiles, ns);
        remoteFiles = await this.drive.list();
      }
      await this.tombstones.load(remoteFiles, tombstoneName(ns));

      const local = await this.scanLocal(onProgress);
      const remote = this.mapRemote(remoteFiles, ns);
      const actions = this.reconcile(local, remote);
      const indexSize = Object.keys(this.store.index).length;

      if (needsFirstSyncConfirm(indexSize, actions)) {
        // The user reviews every change (including deletes) instead of the
        // mass-delete guard, which can't judge a pass with no history.
        const ok = confirmFirst
          ? await confirmFirst({
              namespace: ns,
              localCount: local.size,
              remoteCount: remote.size,
              otherNamespaces: summarizeRemote(remoteFiles).vaults.map((g) => g.ns).filter((n) => n !== ns),
              plan: summarizePlan(actions),
            })
          : true;
        if (!ok) return { kind: "cancelled" };
      } else {
        const stop = massDeleteReason(actions, indexSize);
        if (stop) throw new Error(stop);
      }

      const result = emptyResult();
      await this.apply(actions, ns, onProgress, result);

      await this.tombstones.flush();
      await this.store.persist();
      return { kind: "done", result };
    } finally {
      this.running = false;
    }
  }

  /**
   * v0.1.0 stored files un-prefixed. Move the ones this vault owns (their ids
   * are in our index) into our namespace by renaming in place: ids, content and
   * revisions stay the same, so the index remains valid and nothing looks
   * deleted. Legacy files we don't own are left alone.
   */
  private async migrateLegacy(remoteFiles: DriveFile[], ns: string): Promise<void> {
    const owned = new Set(Object.values(this.store.index).map((e) => e.remoteFileId));
    for (const f of remoteFiles) {
      if (!isLegacyName(f.name)) continue;
      if (f.name === LEGACY_TOMBSTONE_FILE) {
        await this.drive.rename(f.id, tombstoneName(ns));
      } else if (owned.has(f.id)) {
        await this.drive.rename(f.id, remoteName(ns, f.name));
      }
    }
    this.store.markMigrated();
    await this.store.persist();
  }

  // --- scanning -----------------------------------------------------------

  /** Hash every eligible vault file (first run has no index -> full hash). */
  private async scanLocal(onProgress: ProgressFn): Promise<Map<string, FileState>> {
    const out = new Map<string, FileState>();
    const files = this.app.vault.getFiles().filter((f) => !isExcluded(f.path));
    let done = 0;
    for (const f of files) {
      onProgress({ phase: "scanning", done: ++done, total: files.length });
      if (Platform.isMobile && f.stat.size > MOBILE_MAX_BYTES) {
        // Too big to sync on mobile, but the file DOES exist — mark it unchanged
        // (hash from the index) so it is never mistaken for a local deletion and
        // trashed remotely. Skipping it entirely would look like a delete.
        const base = this.store.index[f.path];
        if (base) {
          out.set(f.path, { path: f.path, exists: true, hash: base.hash, mtime: f.stat.mtime });
        }
        continue;
      }
      const buf = await this.app.vault.readBinary(f);
      out.set(f.path, {
        path: f.path,
        exists: true,
        hash: await sha1(buf),
        mtime: f.stat.mtime,
      });
    }
    return out;
  }

  /** Only this vault's files, keyed by vault path (namespace prefix stripped). */
  private mapRemote(files: DriveFile[], ns: string): Map<string, FileState> {
    const out = new Map<string, FileState>();
    for (const df of files) {
      const path = pathFromRemote(ns, df.name);
      if (path === null) continue; // another vault, metadata, or legacy
      out.set(path, {
        path,
        exists: true,
        remoteFileId: df.id,
        rev: df.headRevisionId,
        size: df.size ? Number(df.size) : undefined,
      });
    }
    return out;
  }

  // --- decision -----------------------------------------------------------

  reconcile(local: Map<string, FileState>, remote: Map<string, FileState>): SyncAction[] {
    return planSync(this.store.index, local, remote, (p) => this.tombstones.get(p));
  }

  // --- execution ----------------------------------------------------------

  private async apply(
    actions: SyncAction[],
    ns: string,
    onProgress: ProgressFn,
    result: SyncResult,
  ): Promise<void> {
    const idx = this.store.index;
    const now = Date.now();
    const work = actions.filter((a) => a.kind !== "noop");

    let done = 0;
    for (const a of work) {
      onProgress({ phase: "applying", done: ++done, total: work.length, action: a.kind, path: a.path });
      switch (a.kind) {
        case "forget":
          delete idx[a.path];
          this.tombstones.add(a.path, this.store.deviceId);
          break;

        case "upload": {
          const data = await this.readLocal(a.path);
          const file = a.remoteFileId
            ? await this.drive.update(a.remoteFileId, data)
            : await this.drive.create(remoteName(ns, a.path), data);
          idx[a.path] = {
            path: a.path,
            hash: await sha1(data),
            mtime: now,
            remoteFileId: file.id,
            lastSyncRev: file.headRevisionId ?? "",
          };
          this.tombstones.clear(a.path);
          break;
        }

        case "download": {
          if (Platform.isMobile && a.size && a.size > MOBILE_MAX_BYTES) continue; // skipped, not counted
          const data = await this.drive.download(a.remoteFileId);
          await this.writeLocal(a.path, data);
          idx[a.path] = {
            path: a.path,
            hash: await sha1(data),
            mtime: now,
            remoteFileId: a.remoteFileId,
            lastSyncRev: a.rev ?? "",
          };
          this.tombstones.clear(a.path);
          break;
        }

        case "delete-local": {
          await this.removeLocal(a.path);
          delete idx[a.path];
          this.tombstones.add(a.path, this.store.deviceId);
          break;
        }

        case "delete-remote": {
          await this.drive.trash(a.remoteFileId);
          delete idx[a.path];
          this.tombstones.add(a.path, this.store.deviceId);
          break;
        }

        case "conflict":
          // Identical on both sides is a match, not a conflict: don't count it.
          if ((await this.resolveConflict(a, now, ns)) === "matched") continue;
          break;
      }
      tally(result, a.kind);
    }
  }

  /**
   * Keep both versions (CONTEXT Q14). base=true: remote takes the canonical name
   * and the local copy is set aside (converges: after A uploads, B conflicts
   * once and stops). base=false: first-run collision, local stays canonical and
   * the remote copy is set aside.
   */
  private async resolveConflict(
    a: Extract<SyncAction, { kind: "conflict" }>,
    now: number,
    ns: string,
  ): Promise<"matched" | "copied"> {
    const idx = this.store.index;
    const localData = await this.readLocal(a.path);
    const remoteData = await this.drive.download(a.remoteFileId);
    const localHash = await sha1(localData);

    if (localHash === (await sha1(remoteData))) {
      // Same content both sides (typical when a vault was copied to a new device
      // before its first sync): adopt the remote file as the base, write nothing.
      idx[a.path] = {
        path: a.path, hash: localHash, mtime: now,
        remoteFileId: a.remoteFileId, lastSyncRev: a.rev ?? "",
      };
      this.tombstones.clear(a.path);
      return "matched";
    }

    const copyPath = conflictName(a.path, this.store.deviceId);
    if (a.base) {
      // remote wins the canonical name; local becomes the conflict copy
      await this.writeLocal(copyPath, localData);
      await this.writeLocal(a.path, remoteData);
      const copyFile = await this.drive.create(remoteName(ns, copyPath), localData);
      idx[a.path] = {
        path: a.path, hash: await sha1(remoteData), mtime: now,
        remoteFileId: a.remoteFileId, lastSyncRev: a.rev ?? "",
      };
      idx[copyPath] = {
        path: copyPath, hash: await sha1(localData), mtime: now,
        remoteFileId: copyFile.id, lastSyncRev: copyFile.headRevisionId ?? "",
      };
    } else {
      // first-run collision: local stays canonical; remote saved aside
      await this.writeLocal(copyPath, remoteData);
      const mainFile = await this.drive.update(a.remoteFileId, localData);
      const copyFile = await this.drive.create(remoteName(ns, copyPath), remoteData);
      idx[a.path] = {
        path: a.path, hash: await sha1(localData), mtime: now,
        remoteFileId: a.remoteFileId, lastSyncRev: mainFile.headRevisionId ?? "",
      };
      idx[copyPath] = {
        path: copyPath, hash: await sha1(remoteData), mtime: now,
        remoteFileId: copyFile.id, lastSyncRev: copyFile.headRevisionId ?? "",
      };
    }
    this.tombstones.clear(a.path);
    return "copied";
  }

  // --- vault IO (path-based, works on desktop + mobile) -------------------

  private readLocal(path: string): Promise<ArrayBuffer> {
    return this.app.vault.adapter.readBinary(path);
  }

  private async writeLocal(path: string, data: ArrayBuffer): Promise<void> {
    const slash = path.lastIndexOf("/");
    if (slash > 0) await this.ensureFolder(path.slice(0, slash));
    await this.app.vault.adapter.writeBinary(path, data);
  }

  private async removeLocal(path: string): Promise<void> {
    if (await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(await this.app.vault.adapter.exists(cur))) {
        try { await this.app.vault.adapter.mkdir(cur); } catch { /* race: already made */ }
      }
    }
  }
}

/** Insert " (conflict YYYY-MM-DD hhmm dev)" before the extension. */
function conflictName(path: string, deviceId: string): string {
  const dot = path.lastIndexOf(".");
  const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stem} (conflict ${stamp} ${deviceId.slice(0, 6)})${ext}`;
}
