import { Notice, Platform, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, NSyncSettingTab, type NSyncSettings } from "./settings";
import { IndexStore } from "./sync/indexStore";
import { SyncEngine } from "./sync/engine";
import { DriveClient } from "./drive/driveClient";
import { refresh, type TokenSet } from "./auth/oauth";
import { AuthManager, MOBILE_CALLBACK_ACTION } from "./auth/authManager";
import { isValidNamespace } from "./sync/namespace";

declare const require: (mod: string) => any;

/** Open a URL in the system browser on both desktop (Electron) and mobile. */
function openExternal(url: string): void {
  if (Platform.isDesktopApp) {
    require("electron").shell.openExternal(url);
  } else {
    window.open(url, "_blank");
  }
}

// data.json layout (all per-device, excluded from sync):
//   { settings, index, deviceId, auth }
interface PersistedAuth {
  token?: TokenSet;
}

export default class NSyncPlugin extends Plugin {
  settings: NSyncSettings = DEFAULT_SETTINGS;
  private store!: IndexStore;
  private engine!: SyncEngine;
  private drive!: DriveClient;
  private authManager!: AuthManager;
  private auth: PersistedAuth = {};
  private timer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = await IndexStore.load(this, this.app.vault.getName());

    this.drive = new DriveClient(() => this.accessToken());
    this.engine = new SyncEngine(this.app, this.drive, this.store);
    this.authManager = new AuthManager(
      openExternal,
      () => this.settings.mobileRedirectBridge,
    );

    // Ribbon button + command = the manual "Sync" trigger (CONTEXT Q6).
    this.addRibbonIcon("refresh-cw", "NSync: sync vault", () => this.runSync());
    this.addCommand({
      id: "nsync-now",
      name: "Sync now",
      callback: () => this.runSync(),
    });

    // Mobile OAuth callback: obsidian://nsync-auth?code=...&state=...
    this.registerObsidianProtocolHandler(MOBILE_CALLBACK_ACTION, (params) => {
      void this.authManager.handleMobileCallback(params);
    });

    this.addSettingTab(new NSyncSettingTab(this.app, this));
    this.rescheduleAutoSync();
  }

  onunload(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  // --- sync scheduling ----------------------------------------------------

  rescheduleAutoSync(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (!this.settings.autoSyncEnabled) return;
    this.timer = window.setInterval(
      () => this.runSync(),
      this.settings.autoSyncSeconds * 1000,
    );
    this.registerInterval(this.timer);
  }

  private async runSync(): Promise<void> {
    if (!this.isAuthed()) {
      new Notice("NSync: not signed in.");
      return;
    }
    try {
      await this.engine.sync();
    } catch (e) {
      console.error("NSync failed", e);
      new Notice(`NSync failed: ${(e as Error).message}`);
    }
  }

  // --- namespace ----------------------------------------------------------

  get namespace(): string {
    return this.store.namespace;
  }

  async changeNamespace(ns: string): Promise<void> {
    if (!isValidNamespace(ns)) {
      new Notice("NSync: vault name can't be empty or contain \"/\".");
      return;
    }
    if (ns === this.store.namespace) return;
    await this.store.setNamespace(ns);
    new Notice(`NSync: now syncing as "${ns}". Next sync merges with it.`);
  }

  // --- auth ---------------------------------------------------------------

  isAuthed(): boolean {
    return !!this.auth.token?.refreshToken;
  }

  async toggleAuth(): Promise<void> {
    if (this.isAuthed()) {
      this.auth = {};
      await this.persistAuth();
      new Notice("NSync: signed out.");
      return;
    }
    try {
      new Notice("NSync: opening Google sign-in…");
      const token = await this.authManager.signIn();
      this.auth = { token };
      await this.persistAuth();
      new Notice("NSync: signed in.");
    } catch (e) {
      console.error("NSync sign-in failed", e);
      new Notice(`NSync sign-in failed: ${(e as Error).message}`);
    }
  }

  private async persistAuth(): Promise<void> {
    await this.saveData({ ...(await this.loadData()), auth: this.auth });
  }

  /** Returns a valid access token, refreshing if near expiry. */
  private async accessToken(): Promise<string> {
    let t = this.auth.token;
    if (!t) throw new Error("Not authenticated");
    if (Date.now() > t.expiresAt - 60_000) {
      t = await refresh(t.refreshToken);
      this.auth.token = t;
      await this.persistAuth();
    }
    return t.accessToken;
  }

  // --- persistence --------------------------------------------------------

  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as {
      settings?: Partial<NSyncSettings>;
      auth?: PersistedAuth;
    };
    this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    this.auth = data.auth ?? {};
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...(await this.loadData()), settings: this.settings });
  }
}
