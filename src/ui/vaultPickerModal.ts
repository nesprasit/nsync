import { type App, Modal, Setting } from "obsidian";
import { formatBytes, type VaultGroup } from "../sync/remoteSummary";
import { PLUGIN_NAME } from "./notify";

// Lists the vaults stored on Google Drive so the user can link this vault to
// one of them instead of typing its name. Works on desktop and mobile: it only
// reads the Drive listing and changes this vault's own setting.

export class VaultPickerModal extends Modal {
  constructor(
    app: App,
    private readonly load: () => Promise<VaultGroup[]>,
    private readonly current: string,
    private readonly onPick: (namespace: string) => Promise<void>,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.titleEl.setText(`${PLUGIN_NAME}: choose a vault on Google Drive`);
    const status = this.contentEl.createEl("p", { text: "Loading…" });
    try {
      const vaults = await this.load();
      status.remove();
      this.render(vaults);
    } catch (e) {
      status.setText(`Couldn't load the vault list: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(vaults: VaultGroup[]): void {
    const { contentEl } = this;
    if (vaults.length === 0) {
      contentEl.createEl("p", {
        text:
          "There are no vaults on Google Drive yet. Sync from another device first, " +
          "or keep the current name to start a new vault on Drive.",
      });
      return;
    }

    contentEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Pick the vault this one should sync with. The first sync afterwards shows " +
        "what will be downloaded before anything is written.",
    });

    for (const v of vaults) {
      const isCurrent = v.ns === this.current;
      const changed = v.lastModified ? ` · last changed ${new Date(v.lastModified).toLocaleString()}` : "";
      new Setting(contentEl)
        .setName(isCurrent ? `${v.ns} (current)` : v.ns)
        .setDesc(`${v.files.length} files · ${formatBytes(v.bytes)}${changed}`)
        .addButton((b) => {
          b.setButtonText(isCurrent ? "Linked" : "Use this vault").setDisabled(isCurrent);
          if (!isCurrent) {
            b.setCta().onClick(() => {
              this.close();
              void this.onPick(v.ns);
            });
          }
        });
    }
  }
}
