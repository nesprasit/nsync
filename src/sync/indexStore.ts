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

  static async load(plugin: Plugin): Promise<IndexStore> {
    const raw = ((await plugin.loadData()) ?? {}) as Partial<PersistedState>;
    const state: PersistedState = {
      index: raw.index ?? {},
      deviceId: raw.deviceId ?? crypto.randomUUID(),
    };
    const store = new IndexStore(plugin, state);
    if (!raw.deviceId) await store.persist();
    return store;
  }

  get index(): SyncIndex {
    return this.state.index;
  }

  get deviceId(): string {
    return this.state.deviceId;
  }

  async persist(): Promise<void> {
    // NOTE: merge with whatever else is in data.json (settings, auth) so we
    // don't clobber it. main.ts owns the merge in the real implementation.
    const existing = ((await this.plugin.loadData()) ?? {}) as object;
    await this.plugin.saveData({ ...existing, ...this.state });
  }
}
