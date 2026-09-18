import { type App, Modal, Setting } from "obsidian";
import { namespaceHint, type FirstSyncInfo } from "../sync/firstSync";
import { PLUGIN_NAME } from "./notify";

// Shown before the first sync of a vault on this device. Nothing is written
// until the user presses "Start sync"; closing the modal counts as cancel.

const MAX_LISTED = 100;

export class FirstSyncModal extends Modal {
  private resolve: ((ok: boolean) => void) | null = null;

  constructor(
    app: App,
    private readonly info: FirstSyncInfo,
    private readonly email?: string,
  ) {
    super(app);
  }

  /** Opens the modal and resolves true on "Start sync", false on cancel/close. */
  ask(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl, info } = this;
    this.titleEl.setText(`${PLUGIN_NAME}: first sync of "${info.namespace}"`);

    contentEl.createEl("p", {
      text: "This vault hasn't synced on this device before. Nothing has been changed yet. Review what will happen:",
    });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text:
        `${this.email ? `Google account: ${this.email} · ` : ""}` +
        `Vault name on Google Drive: ${info.namespace} · ` +
        `${info.localCount} files here, ${info.remoteCount} on Drive`,
    });

    const hint = namespaceHint(info);
    if (hint) contentEl.createEl("p", { text: hint, cls: "nsync-warning" });

    const { plan } = info;
    this.group(`↑ Upload to Drive: ${plan.upload.length}`, plan.upload);
    this.group(`↓ Download to this device: ${plan.download.length}`, plan.download);
    this.group(
      `⇄ On both sides: ${plan.both.length} (identical files are matched, different ones are kept as conflict copies)`,
      plan.both,
    );
    this.group(
      `🗑 Delete on this device: ${plan.deleteLocal.length} (deleted on another device)`,
      plan.deleteLocal,
      plan.deleteLocal.length > 0 ? "nsync-danger" : undefined,
    );
    this.group(`🗑 Move to Drive trash: ${plan.deleteRemote.length}`, plan.deleteRemote);

    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Tip: back up your vault before the first sync.",
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(false)))
      .addButton((b) => b.setButtonText("Start sync").setCta().onClick(() => this.finish(true)));
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(false); // closing with Esc / × is a cancel
  }

  private finish(ok: boolean): void {
    const r = this.resolve;
    this.resolve = null;
    if (r) {
      r(ok);
      this.close();
    }
  }

  private group(title: string, paths: string[], cls?: string): void {
    if (paths.length === 0) return;
    const details = this.contentEl.createEl("details");
    details.createEl("summary", { text: title, cls });
    const list = details.createEl("ul", { cls: "nsync-file-list" });
    for (const p of paths.slice(0, MAX_LISTED)) list.createEl("li", { text: p });
    if (paths.length > MAX_LISTED) {
      details.createEl("p", {
        cls: "setting-item-description",
        text: `…and ${paths.length - MAX_LISTED} more`,
      });
    }
  }
}
