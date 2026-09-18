import { type App, Platform, PluginSettingTab, Setting } from "obsidian";
import type NSyncPlugin from "./main";

export interface NSyncSettings {
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
  autoSyncSeconds: 60,
  autoSyncEnabled: true,
  trashRetentionDays: 30,
  mobileRedirectBridge: "",
};

export class NSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: NSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Google account")
      .setDesc(this.plugin.isAuthed() ? "Connected." : "Not connected.")
      .addButton((b) =>
        b
          .setButtonText(this.plugin.isAuthed() ? "Sign out" : "Sign in with Google")
          .onClick(() => this.plugin.toggleAuth()),
      );

    new Setting(containerEl)
      .setName("Files on Drive")
      .setDesc("See what NSync has stored in its hidden Google Drive folder, per vault.")
      .addButton((b) =>
        b
          .setButtonText("Show files")
          .setDisabled(!this.plugin.isAuthed())
          .onClick(() => this.plugin.showRemoteFiles()),
      );

    let pendingNs = this.plugin.namespace;
    new Setting(containerEl)
      .setName("Vault name on Drive")
      .setDesc(
        "Devices that use the same name sync the same vault. Keep it identical " +
          "on every device. Changing it starts a fresh merge with that name.",
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
}
