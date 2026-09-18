import type { Plugin } from "obsidian";
import type { SyncIndex } from "./types";

// The per-device sync index lives in the plugin's own data.json, which Obsidian
// stores under .obsidian/plugins/<id>/. This must be EXCLUDED from the sync
// scope (see CONTEXT + ADR): it holds device-local state and, alongside it, the
// refresh token. (Tombstones are shared across devices, so they live remotely —
// see tombstones.ts, not here.)

export interface PersistedState {
  index: SyncIndex;
  deviceId: string;
  /** Drive namespace for this vault. Pinned at first load; see namespace.ts. */
  namespace: string;
  /** True once any pre-namespace (legacy) remote files have been moved in. */
  nsMigrated: boolean;
  // auth + settings are persisted here too; see settings.ts
}

export class IndexStore {
  private state: PersistedState;

  private constructor(
    private readonly plugin: Plugin,
    state: PersistedState,
  ) {
    this.state = state;
  }

  /** @param defaultNamespace used only when this vault has no namespace yet (the vault name). */
  static async load(plugin: Plugin, defaultNamespace: string): Promise<IndexStore> {
    const raw = ((await plugin.loadData()) ?? {}) as Partial<PersistedState>;
    const index = raw.index ?? {};
    const state: PersistedState = {
      index,
      deviceId: raw.deviceId ?? crypto.randomUUID(),
      namespace: raw.namespace ?? defaultNamespace,
      // A vault that never synced has nothing legacy to adopt.
      nsMigrated: raw.nsMigrated ?? Object.keys(index).length === 0,
    };
    const store = new IndexStore(plugin, state);
    if (!raw.deviceId || raw.namespace === undefined || raw.nsMigrated === undefined) {
      await store.persist();
    }
    return store;
  }

  get index(): SyncIndex {
    return this.state.index;
  }

  get deviceId(): string {
    return this.state.deviceId;
  }

  get namespace(): string {
    return this.state.namespace;
  }

  get needsLegacyMigration(): boolean {
    return !this.state.nsMigrated;
  }

  markMigrated(): void {
    this.state.nsMigrated = true;
  }

  /**
   * Point this vault at a different namespace. The index is cleared so the next
   * sync is a first-run merge: nothing local can be deleted because of files
   * that "vanished" from the old namespace.
   */
  async setNamespace(ns: string): Promise<void> {
    this.state.namespace = ns;
    this.state.index = {};
    this.state.nsMigrated = true;
    await this.persist();
  }

  async persist(): Promise<void> {
    // NOTE: merge with whatever else is in data.json (settings, auth) so we
    // don't clobber it. main.ts owns the merge in the real implementation.
    const existing = ((await this.plugin.loadData()) ?? {}) as object;
    await this.plugin.saveData({ ...existing, ...this.state });
  }
}
