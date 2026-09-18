import { Platform, Plugin } from "obsidian";
import { StatusIndicator } from "./ui/statusIndicator";
import { notify, updateNotice, PLUGIN_NAME } from "./ui/notify";
import { progressText, summaryText, type SyncProgress } from "./sync/progress";
import { DEFAULT_SETTINGS, NSyncSettingTab, type NSyncSettings } from "./settings";
import { IndexStore } from "./sync/indexStore";
import { SyncEngine } from "./sync/engine";
import { DriveClient } from "./drive/driveClient";
import { refresh, type TokenSet } from "./auth/oauth";
import { AuthManager, MOBILE_CALLBACK_ACTION, type PendingAuth } from "./auth/authManager";
import { clientProblem, normalizeClient, type OAuthClient } from "./auth/client";
import { isValidNamespace } from "./sync/namespace";
import { summarizeRemote } from "./sync/remoteSummary";
import { RemoteFilesModal } from "./ui/remoteFilesModal";
import { SignInLinkModal } from "./ui/signInLinkModal";
import { FirstSyncModal } from "./ui/firstSyncModal";
import type { FirstSyncInfo } from "./sync/firstSync";

/**
 * Credentials are remembered per device (window.localStorage is shared by all
 * vaults in the app) so each vault on this device doesn't need them re-entered.
 * Never synced: NSync doesn't sync .obsidian, and localStorage isn't a file.
 */
const DEVICE_CLIENT_KEY = "nsync:oauth-client";

declare const require: (mod: string) => unknown;
interface ElectronShell {
  shell: { openExternal(url: string): Promise<void> };
}

/** Open a URL in the system browser on desktop (Electron). */
function openExternal(url: string): void {
  void (require("electron") as ElectronShell).shell.openExternal(url);
}

// data.json layout (all per-device, excluded from sync):
//   { settings, index, deviceId, namespace, nsMigrated, auth, pendingAuth }
interface PersistedAuth {
  token?: TokenSet;
  /** Signed-in Google account, shown in settings. */
  email?: string;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The parts of data.json this file reads (IndexStore owns the rest). */
interface PersistedData {
  settings?: Partial<NSyncSettings>;
  auth?: PersistedAuth;
  pendingAuth?: PendingAuth | null;
}

export default class NSyncPlugin extends Plugin {
  settings: NSyncSettings = DEFAULT_SETTINGS;
  private store!: IndexStore;
  private engine!: SyncEngine;
  private drive!: DriveClient;
  private authManager!: AuthManager;
  private settingTab!: NSyncSettingTab;
  private status!: StatusIndicator;
  private auth: PersistedAuth = {};
  private timer: number | null = null;
  /** Last auto-sync error shown, so a failing 60s timer notifies once, not every minute. */
  private lastAutoError: string | null = null;
  /** The auto-sync "first sync is waiting for review" notice was already shown. */
  private firstSyncNotified = false;

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
        load: async () => (await this.readData()).pendingAuth ?? null,
        save: async (p) => this.saveData({ ...(await this.readData()), pendingAuth: p }),
      },
      () => this.oauthClient(),
    );

    // Ribbon button, command and status bar = the manual "Sync" trigger (CONTEXT Q6).
    this.addRibbonIcon("refresh-cw", "Sync with Google Drive", () => void this.runSync(true));
    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => void this.runSync(true),
    });

    // Desktop only in practice: Obsidian mobile has no status bar.
    const statusEl = this.addStatusBarItem();
    statusEl.onClickEvent(() => void this.runSync(true));
    this.status = new StatusIndicator(statusEl);
    this.showIdleStatus();
    this.addCommand({
      id: "show-files-on-drive",
      name: "Show files on Google Drive",
      callback: () => this.showRemoteFiles(),
    });

    // Mobile OAuth callback: obsidian://nsync-auth?code=...&state=...
    // The pending sign-in is read from data.json, so this works even if iOS
    // reloaded Obsidian while the user was in Safari.
    this.registerObsidianProtocolHandler(MOBILE_CALLBACK_ACTION, (params) => {
      this.authManager.completeMobile(params).then(
        (token) => this.completeSignIn(token),
        (e: unknown) => {
          console.error("NSync sign-in failed", e);
          notify(`sign-in failed: ${errorMessage(e)}`);
        },
      );
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
      () => void this.runSync(false),
      this.settings.autoSyncSeconds * 1000,
    );
    this.registerInterval(this.timer);
  }

  /**
   * @param manual true for the button/command: shows a live progress notice.
   *   The 60s auto-sync only updates the status bar, so it stays quiet.
   */
  private async runSync(manual: boolean): Promise<void> {
    if (!this.isAuthed()) {
      if (manual) notify("not signed in.");
      return;
    }
    if (this.engine.isRunning) {
      if (manual) notify("a sync is already running.");
      return;
    }

    let notice = manual ? notify("starting…", 0) : null;
    let lastPaint = 0;
    // First sync of this vault here: manual shows the review modal; the 60s
    // timer never writes on its own and just flags that a review is waiting.
    const confirmFirst = async (info: FirstSyncInfo): Promise<boolean> => {
      if (!manual) return false;
      notice?.hide();
      const ok = await new FirstSyncModal(this.app, info, this.auth.email).ask();
      if (ok) notice = notify("syncing…", 0);
      return ok;
    };
    const onProgress = (p: SyncProgress) => {
      this.status.set("syncing", progressText(p), `${PLUGIN_NAME}: ${progressText(p)}`);
      // Scanning can report thousands of files; repaint the notice at most ~10x/s.
      const now = Date.now();
      if (notice && (p.phase !== "scanning" || now - lastPaint > 100)) {
        updateNotice(notice, `${progressText(p, true)}`);
        lastPaint = now;
      }
    };

    try {
      const outcome = await this.engine.sync(onProgress, confirmFirst);
      if (outcome.kind === "busy") {
        notice?.hide();
        return;
      }
      if (outcome.kind === "cancelled") {
        notice?.hide();
        this.status.set("attention", "review first sync", `${PLUGIN_NAME}: this vault's first sync needs your OK. Click to review.`);
        if (manual) {
          notify("first sync cancelled. Nothing was changed.");
        } else if (!this.firstSyncNotified) {
          notify("ready for this vault's first sync. Press sync (🔄) to review and start.");
          this.firstSyncNotified = true;
        }
        return;
      }
      const summary = summaryText(outcome.result);
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      this.status.set("ok", time, `${PLUGIN_NAME}: last sync ${time}, ${summary}. Click to sync now.`);
      this.lastAutoError = null;
      const done = notice;
      if (done) {
        updateNotice(done, `${summary}`);
        window.setTimeout(() => done.hide(), 4000);
      }
    } catch (e) {
      const msg = errorMessage(e);
      console.error("NSync failed", e);
      notice?.hide();
      this.status.set("error", "sync failed", `${PLUGIN_NAME}: ${msg} Click to retry.`);
      if (manual || msg !== this.lastAutoError) notify(`sync failed: ${msg}`);
      if (!manual) this.lastAutoError = msg;
    }
  }

  /** Resting state before the first sync of the session, or after sign-in/out. */
  private showIdleStatus(): void {
    if (this.isAuthed()) {
      this.status.set("idle", "NSync", `${PLUGIN_NAME}: click to sync now`);
    } else {
      this.status.set("signed-out", "signed out", `${PLUGIN_NAME}: not signed in. Open settings to sign in.`);
    }
  }

  /** Read-only browser for the hidden appDataFolder (the Drive UI can't show it). */
  showRemoteFiles(): void {
    if (!this.isAuthed()) {
      notify("sign in first.");
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
      notify("vault name can't be empty or contain \"/\".");
      return;
    }
    if (ns === this.store.namespace) return;
    await this.store.setNamespace(ns);
    notify(`now syncing as "${ns}". Next sync merges with it.`);
  }

  // --- auth ---------------------------------------------------------------

  isAuthed(): boolean {
    return !!this.auth.token?.refreshToken;
  }

  private oauthClient(): OAuthClient {
    return normalizeClient(this.settings);
  }

  /** Save the user's OAuth client. Switching to a different client signs out. */
  async setOAuthClient(c: OAuthClient): Promise<void> {
    const next = normalizeClient(c);
    const problem = clientProblem(next);
    if (problem) {
      notify(`${problem}`);
      return;
    }
    const changed = next.clientId !== this.settings.clientId;
    this.settings.clientId = next.clientId;
    this.settings.clientSecret = next.clientSecret;
    await this.saveSettings();
    try {
      window.localStorage.setItem(DEVICE_CLIENT_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: vaults will just ask again
    }
    if (changed && this.isAuthed()) {
      // Tokens are bound to the client that issued them.
      this.auth = {};
      await this.persistAuth();
      this.showIdleStatus();
      notify("OAuth client changed. Sign in again.");
    } else {
      notify("OAuth client saved.");
    }
  }

  /** Email of the signed-in Google account, if known. */
  get accountEmail(): string | undefined {
    return this.auth.email;
  }

  async toggleAuth(): Promise<void> {
    if (this.isAuthed()) {
      this.auth = {};
      await this.persistAuth();
      notify("signed out.");
      this.showIdleStatus();
      this.refreshSettingTab();
      return;
    }
    try {
      notify("opening Google sign-in…");
      const token = await this.authManager.signIn();
      // Desktop returns the token here; mobile finishes in the protocol handler.
      if (token) await this.completeSignIn(token);
    } catch (e) {
      console.error("NSync sign-in failed", e);
      notify(`sign-in failed: ${errorMessage(e)}`);
    }
  }

  private async completeSignIn(token: TokenSet): Promise<void> {
    this.auth = { token };
    await this.persistAuth();
    await this.refreshAccountEmail();
    notify(this.auth.email ? `signed in as ${this.auth.email}` : "signed in.");
    this.showIdleStatus();
    this.refreshSettingTab();
    // Go straight to the first sync; if this vault never synced here, the
    // review modal opens before anything is written.
    void this.runSync(true);
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
    await this.saveData({ ...(await this.readData()), auth: this.auth });
  }

  /** Returns a valid access token, refreshing if near expiry. */
  private async accessToken(): Promise<string> {
    let t = this.auth.token;
    if (!t) throw new Error("Not authenticated");
    if (Date.now() > t.expiresAt - 60_000) {
      const client = this.oauthClient();
      const problem = clientProblem(client);
      if (problem) throw new Error(problem);
      t = await refresh(client, t.refreshToken);
      this.auth.token = t;
      await this.persistAuth();
    }
    return t.accessToken;
  }

  // --- persistence --------------------------------------------------------

  /** data.json, typed for the fields this file owns. */
  private async readData(): Promise<PersistedData> {
    return ((await this.loadData()) as PersistedData | null) ?? {};
  }

  async loadSettings(): Promise<void> {
    const data = await this.readData();
    this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    this.auth = data.auth ?? {};
    // New vault on a device that already has credentials: reuse them.
    if (!this.settings.clientId && !this.settings.clientSecret) {
      try {
        const saved = window.localStorage.getItem(DEVICE_CLIENT_KEY);
        if (saved) Object.assign(this.settings, normalizeClient(JSON.parse(saved) as Partial<OAuthClient>));
      } catch {
        // ignore: the user can enter them in settings
      }
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...(await this.readData()), settings: this.settings });
  }
}
