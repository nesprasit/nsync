import type { DriveClient, DriveFile } from "../drive/driveClient";
import type { Tombstone } from "./types";

// Tombstones are stored in a single shared JSON file inside appDataFolder, so a
// brand-new device (which has no local index) still learns that a file was
// deleted elsewhere and does not resurrect it. The local index alone handles
// deletes between devices that share a base; tombstones cover the no-base case.

export const TOMBSTONE_FILE = "__nsync_tombstones__.json";

export class TombstoneStore {
  private map = new Map<string, Tombstone>();
  private remoteFileId: string | null = null;
  private dirty = false;

  constructor(private readonly drive: DriveClient) {}

  /** Load from the remote file (call once per sync, before reconcile). */
  async load(remoteFiles: DriveFile[]): Promise<void> {
    const f = remoteFiles.find((x) => x.name === TOMBSTONE_FILE);
    this.remoteFileId = f?.id ?? null;
    this.map.clear();
    if (!f) return;
    try {
      const buf = await this.drive.download(f.id);
      const arr = JSON.parse(new TextDecoder().decode(buf)) as Tombstone[];
      for (const t of arr) this.map.set(t.path, t);
    } catch {
      // A corrupt/unreadable tombstone file must not block a sync.
    }
  }

  get(path: string): Tombstone | undefined {
    return this.map.get(path);
  }

  /** Record (or refresh) a delete. Newest deletedAt wins. */
  add(path: string, deviceId: string): void {
    const existing = this.map.get(path);
    const t: Tombstone = { path, deletedAt: Date.now(), deletedBy: deviceId };
    if (!existing || existing.deletedAt < t.deletedAt) {
      this.map.set(path, t);
      this.dirty = true;
    }
  }

  /** A file with this path exists again — clear any tombstone. */
  clear(path: string): void {
    if (this.map.delete(path)) this.dirty = true;
  }

  /** Drop tombstones older than `days` (retention purge). */
  prune(days: number): void {
    const cutoff = Date.now() - days * 86_400_000;
    for (const [path, t] of this.map) {
      if (t.deletedAt < cutoff) {
        this.map.delete(path);
        this.dirty = true;
      }
    }
  }

  /** Persist to the remote file if anything changed. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    const data = new TextEncoder().encode(JSON.stringify([...this.map.values()]))
      .buffer as ArrayBuffer;
    if (this.remoteFileId) {
      await this.drive.update(this.remoteFileId, data);
    } else {
      const f = await this.drive.create(TOMBSTONE_FILE, data);
      this.remoteFileId = f.id;
    }
    this.dirty = false;
  }
}
