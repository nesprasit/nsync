import { Notice, Platform, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, NSyncSettingTab, type NSyncSettings } from "./settings";
import { IndexStore } from "./sync/indexStore";
import { SyncEngine } from "./sync/engine";
import { DriveClient } from "./drive/driveClient";
import { refresh, type TokenSet } from "./auth/oauth";
import { AuthManager, MOBILE_CALLBACK_ACTION, type PendingAuth } from "./auth/authManager";
import { isValidNamespace } from "./sync/namespace";
import { summarizeRemote } from "./sync/remoteSummary";
import { RemoteFilesModal } from "./ui/remoteFilesModal";
import { SignInLinkModal } from "./ui/signInLinkModal";

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
//   { settings, index, deviceId, namespace, nsMigrated, auth, pendingAuth }
interface PersistedAuth {
  token?: TokenSet;
  /** Signed-in Google account, shown in settings. */
  email?: string;
}

export default class NSyncPlugin extends Plugin {
  settings: NSyncSettings = DEFAULT_SETTINGS;
  private store!: IndexStore;
  private engine!: SyncEngine;
  private drive!: DriveClient;
  private authManager!: AuthManager;
  private settingTab!: NSyncSettingTab;
  private auth: PersistedAuth = {};
  private timer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = await IndexStore.load(this, this.app.vault.getName());

    this.drive = new DriveClient(() => this.accessToken());
    this.engine = new SyncEngine(this.app, this.drive, this.store);
    this.authManager = new AuthManager(
      // Desktop can open the browser programmatically; mobile needs a direct tap.
      (url) => (Platform.isDesktopApp ? openExternal(url) : new SignInLinkModal(this.app, url).open()),
      () => this.settings.mobileRedirectBridge,
      {
        load: async () => ((await this.loadData())?.pendingAuth as PendingAuth | undefined) ?? null,
        save: async (p) => this.saveData({ ...(await this.loadData()), pendingAuth: p }),
      },
    );

    // Ribbon button + command = the manual "Sync" trigger (CONTEXT Q6).
    this.addRibbonIcon("refresh-cw", "NSync: sync vault", () => this.runSync());
    this.addCommand({
      id: "nsync-now",
      name: "Sync now",
      callback: () => this.runSync(),
    });
    this.addCommand({
      id: "nsync-show-remote",
      name: "Show files on Drive",
      callback: () => this.showRemoteFiles(),
    });

    // Mobile OAuth callback: obsidian://nsync-auth?code=...&state=...
    // The pending sign-in is read from data.json, so this works even if iOS
    // reloaded Obsidian while the user was in Safari.
    this.registerObsidianProtocolHandler(MOBILE_CALLBACK_ACTION, async (params) => {
      try {
        await this.completeSignIn(await this.authManager.completeMobile(params));
      } catch (e) {
        console.error("NSync sign-in failed", e);
        new Notice(`NSync sign-in failed: ${(e as Error).message}`);
      }
    });

    this.settingTab = new NSyncSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.rescheduleAutoSync();

    // Signed in before emails were recorded: look it up once in the background.
    if (this.isAuthed() && !this.auth.email) void this.refreshAccountEmail();
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

  /** Read-only browser for the hidden appDataFolder (the Drive UI can't show it). */
  showRemoteFiles(): void {
    if (!this.isAuthed()) {
      new Notice("NSync: sign in first.");
      return;
    }
    new RemoteFilesModal(
      this.app,
      async () => summarizeRemote(await this.drive.list()),
      this.store.namespace,
    ).open();
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

  /** Email of the signed-in Google account, if known. */
  get accountEmail(): string | undefined {
    return this.auth.email;
  }

  async toggleAuth(): Promise<void> {
    if (this.isAuthed()) {
      this.auth = {};
      await this.persistAuth();
      new Notice("NSync: signed out.");
      this.refreshSettingTab();
      return;
    }
    try {
      new Notice("NSync: opening Google sign-in…");
      const token = await this.authManager.signIn();
      // Desktop returns the token here; mobile finishes in the protocol handler.
      if (token) await this.completeSignIn(token);
    } catch (e) {
      console.error("NSync sign-in failed", e);
      new Notice(`NSync sign-in failed: ${(e as Error).message}`);
    }
  }

  private async completeSignIn(token: TokenSet): Promise<void> {
    this.auth = { token };
    await this.persistAuth();
    await this.refreshAccountEmail();
    new Notice(this.auth.email ? `NSync: signed in as ${this.auth.email}` : "NSync: signed in.");
    this.refreshSettingTab();
  }

  private async refreshAccountEmail(): Promise<void> {
    try {
      const { email } = await this.drive.about();
      if (email) {
        this.auth.email = email;
        await this.persistAuth();
        this.refreshSettingTab();
      }
    } catch (e) {
      console.warn("NSync: couldn't look up account email", e);
    }
  }

  /** Re-render settings so the account status reflects the latest state. */
  private refreshSettingTab(): void {
    if (this.settingTab.containerEl.isConnected) this.settingTab.display();
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
