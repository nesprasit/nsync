import { type App, Platform, PluginSettingTab, Setting } from "obsidian";
import type NSyncPlugin from "./main";
import { LOOPBACK_REDIRECT } from "./auth/authManager";
import { parseClientJson } from "./auth/client";

const SETUP_GUIDE = "https://github.com/nesprasit/nsync#1-google-cloud-setup";

export interface NSyncSettings {
  /** The user's own Google Cloud OAuth client (bring your own credentials). */
  clientId: string;
  clientSecret: string;
  /** Auto-sync interval in seconds (CONTEXT: default 60). */
  autoSyncSeconds: number;
  /** Whether the 60s timer runs at all (button still works when off). */
  autoSyncEnabled: boolean;
  /** Days a soft-deleted file is kept in .trash/ before purge. */
  trashRetentionDays: number;
  /**
   * Mobile only: an https page that forwards ?code&state to
   * obsidian://nsync-auth. Google rejects custom schemes as redirect_uri,
   * so mobile needs this bridge. Must also be added as an Authorized redirect
   * URI in the Google Cloud OAuth client.
   */
  mobileRedirectBridge: string;
}

export const DEFAULT_SETTINGS: NSyncSettings = {
  clientId: "",
  clientSecret: "",
  autoSyncSeconds: 60,
  autoSyncEnabled: true,
  trashRetentionDays: 30,
  // A static page that only forwards ?code&state into Obsidian; anyone can use
  // it as long as they register it on their own OAuth client. Editable.
  mobileRedirectBridge: "https://nesprasit.github.io/nsync/callback.html",
};

export class NSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderOAuthClient(containerEl);

    new Setting(containerEl)
      .setName("Google account")
      .setDesc(
        this.plugin.isAuthed()
          ? this.plugin.accountEmail
            ? `Signed in as ${this.plugin.accountEmail}`
            : "Signed in."
          : "Not signed in.",
      )
      .addButton((b) =>
        b
          .setButtonText(this.plugin.isAuthed() ? "Sign out" : "Sign in with Google")
          .onClick(() => this.plugin.toggleAuth()),
      );

    new Setting(containerEl)
      .setName("Files on Google Drive")
      .setDesc("See what this plugin has stored in its hidden Google Drive folder, per vault.")
      .addButton((b) =>
        b
          .setButtonText("Show files")
          .setDisabled(!this.plugin.isAuthed())
          .onClick(() => this.plugin.showRemoteFiles()),
      );

    let pendingNs = this.plugin.namespace;
    new Setting(containerEl)
      .setName("Vault name on Google Drive")
      .setDesc(
        "Devices that use the same name sync the same vault. Pick one that's " +
          "already on Google Drive, or type a new name. Changing it starts a " +
          "fresh merge with that name.",
      )
      .addText((t) =>
        t.setValue(pendingNs).onChange((v) => {
          pendingNs = v.trim();
        }),
      )
      .addButton((b) =>
        b.setButtonText("Apply").onClick(async () => {
          await this.plugin.changeNamespace(pendingNs);
          this.display();
        }),
      )
      .addButton((b) =>
        b
          .setButtonText("Choose from Google Drive")
          .setDisabled(!this.plugin.isAuthed())
          .onClick(() => this.plugin.chooseRemoteVault()),
      );

    new Setting(containerEl)
      .setName("Auto-sync")
      .setDesc("Sync automatically while Obsidian is open.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoSyncEnabled).onChange(async (v) => {
          this.plugin.settings.autoSyncEnabled = v;
          await this.plugin.saveSettings();
          this.plugin.rescheduleAutoSync();
        }),
      );

    new Setting(containerEl)
      .setName("Auto-sync interval (seconds)")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.autoSyncSeconds))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 10) {
              this.plugin.settings.autoSyncSeconds = n;
              await this.plugin.saveSettings();
              this.plugin.rescheduleAutoSync();
            }
          }),
      );

    if (Platform.isMobile) {
      new Setting(containerEl)
        .setName("Mobile redirect bridge URL")
        .setDesc(
          "https page that forwards the Google login code back to Obsidian. " +
            "Required for sign-in on mobile.",
        )
        .addText((t) =>
          t
            .setPlaceholder("https://nesprasit.github.io/nsync/callback.html")
            .setValue(this.plugin.settings.mobileRedirectBridge)
            .onChange(async (v) => {
              this.plugin.settings.mobileRedirectBridge = v.trim();
              await this.plugin.saveSettings();
            }),
        );
    }
  }

  /** "Bring your own credentials": the user's Google Cloud OAuth client. */
  private renderOAuthClient(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Your Google sign-in app").setHeading();

    const intro = containerEl.createEl("p", { cls: "setting-item-description" });
    intro.appendText(
      "This plugin signs in with your own Google Cloud OAuth client, so your data never " +
        "goes through anyone else's app. ",
    );
    intro.createEl("a", { text: "Setup guide (about 10 minutes)", href: SETUP_GUIDE });

    let id = this.plugin.settings.clientId;
    let secret = this.plugin.settings.clientSecret;
    let secretInput: HTMLInputElement | null = null;

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Ends with .apps.googleusercontent.com. You can also paste the whole JSON file you downloaded.")
      .addText((t) =>
        t
          .setPlaceholder("1234-abc.apps.googleusercontent.com")
          .setValue(id)
          .onChange((v) => {
            const parsed = parseClientJson(v);
            if (parsed) {
              id = parsed.clientId;
              secret = parsed.clientSecret;
              t.setValue(id);
              if (secretInput) secretInput.value = secret;
            } else {
              id = v.trim();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Client secret")
      .addText((t) => {
        t.inputEl.type = "password";
        secretInput = t.inputEl;
        t.setPlaceholder("Paste your client secret")
          .setValue(secret)
          .onChange((v) => {
            secret = v.trim();
          });
      })
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(async () => {
            await this.plugin.setOAuthClient({ clientId: id, clientSecret: secret });
            this.display();
          }),
      );

    const uris = containerEl.createDiv({ cls: "setting-item-description" });
    uris.createEl("p", { text: "Add both addresses below as authorized redirects on the client you created:" });
    const list = uris.createEl("ul");
    list.createEl("li").createEl("code", { text: LOOPBACK_REDIRECT });
    list.createEl("li").createEl("code", { text: this.plugin.settings.mobileRedirectBridge });
    uris.createEl("p", { text: "Saved credentials are remembered on this device for your other vaults." });
  }
}
