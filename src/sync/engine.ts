import { type App, Platform } from "obsidian";
import type { DriveClient } from "../drive/driveClient";
import type { IndexStore } from "./indexStore";
import type { FileState, SyncAction } from "./types";
import { TombstoneStore, TOMBSTONE_FILE } from "./tombstones";
import { planSync } from "./reconcile";
import { sha1 } from "./hash";

// Three-state reconciliation: local (L) vs remote (R) vs last-synced base (the
// index, B). Decisions follow CONTEXT.md:
//   - both changed since base          -> conflict copy (never lose data)
//   - only one side changed            -> propagate that side
//   - deleted on one side              -> soft-delete the other + tombstone
//   - new device sees a tombstone      -> honour the delete, don't resurrect

const MOBILE_MAX_BYTES = 50 * 1024 * 1024; // CONTEXT Q18: mobile skips > ~50MB

/** Files/paths that must never be synced (CONTEXT Q9 + token safety). */
const EXCLUDES = [
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".obsidian/cache",
  ".trash/",
];

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

  /** Entry point for both the manual button and the 60s timer. Non-reentrant. */
  async sync(): Promise<void> {
    if (this.running) return; // sync lock: never run two passes at once
    this.running = true;
    try {
      const remoteFiles = await this.drive.list();
      await this.tombstones.load(remoteFiles);

      const local = await this.scanLocal();
      const remote = this.mapRemote(remoteFiles);
      const actions = this.reconcile(local, remote);
      await this.apply(actions, remote);

      await this.tombstones.flush();
      await this.store.persist();
    } finally {
      this.running = false;
    }
  }

  // --- scanning -----------------------------------------------------------

  /** Hash every eligible vault file (first run has no index -> full hash). */
  private async scanLocal(): Promise<Map<string, FileState>> {
    const out = new Map<string, FileState>();
    for (const f of this.app.vault.getFiles()) {
      if (isExcluded(f.path)) continue;
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

  private mapRemote(files: import("../drive/driveClient").DriveFile[]): Map<string, FileState> {
    const out = new Map<string, FileState>();
    for (const df of files) {
      if (df.name === TOMBSTONE_FILE) continue; // engine metadata, not a vault file
      out.set(df.name, {
        path: df.name,
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

  private async apply(actions: SyncAction[], remote: Map<string, FileState>): Promise<void> {
    void remote;
    const idx = this.store.index;
    const now = Date.now();

    for (const a of actions) {
      switch (a.kind) {
        case "noop":
          break;

        case "forget":
          delete idx[a.path];
          this.tombstones.add(a.path, this.store.deviceId);
          break;

        case "upload": {
          const data = await this.readLocal(a.path);
          const file = a.remoteFileId
            ? await this.drive.update(a.remoteFileId, data)
            : await this.drive.create(a.path, data);
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
          if (Platform.isMobile && a.size && a.size > MOBILE_MAX_BYTES) break;
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
          await this.resolveConflict(a, now);
          break;
      }
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
  ): Promise<void> {
    const idx = this.store.index;
    const localData = await this.readLocal(a.path);
    const remoteData = await this.drive.download(a.remoteFileId);
    const copyPath = conflictName(a.path, this.store.deviceId);

    if (a.base) {
      // remote wins the canonical name; local becomes the conflict copy
      await this.writeLocal(copyPath, localData);
      await this.writeLocal(a.path, remoteData);
      const copyFile = await this.drive.create(copyPath, localData);
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
      const copyFile = await this.drive.create(copyPath, remoteData);
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
