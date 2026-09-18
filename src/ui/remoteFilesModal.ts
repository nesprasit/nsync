import { type App, Modal, Setting } from "obsidian";
import { formatBytes, type RemoteEntry, type RemoteSummary } from "../sync/remoteSummary";

// Read-only view of what NSync has stored in the hidden appDataFolder, grouped
// by vault namespace. The Drive web UI can't show this folder, so this is the
// only way to look inside it.

const MAX_ROWS = 300; // per section; the filter narrows larger vaults

export class RemoteFilesModal extends Modal {
  constructor(
    app: App,
    private readonly load: () => Promise<RemoteSummary>,
    private readonly currentNs: string,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.titleEl.setText("NSync: files on Google Drive");
    const status = this.contentEl.createEl("p", { text: "Loading…" });
    try {
      const summary = await this.load();
      status.remove();
      this.render(summary);
    } catch (e) {
      status.setText(`Couldn't load the file list: ${(e as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(s: RemoteSummary): void {
    const { contentEl } = this;
    contentEl.createEl("p", {
      text: `${s.totalFiles} files · ${formatBytes(s.totalBytes)} in NSync's hidden Drive folder`,
    });

    let filter = "";
    new Setting(contentEl).setName("Filter").addText((t) =>
      t.setPlaceholder("Path contains…").onChange((v) => {
        filter = v.trim().toLowerCase();
        draw();
      }),
    );

    const list = contentEl.createDiv();
    const draw = () => {
      list.empty();
      if (s.totalFiles === 0) {
        list.createEl("p", { text: "Nothing synced yet." });
        return;
      }
      for (const g of s.vaults) {
        const label = g.ns === this.currentNs ? `${g.ns} (this vault)` : g.ns;
        this.section(list, `${label}: ${g.files.length} files · ${formatBytes(g.bytes)}`,
          g.files, filter, g.ns === this.currentNs);
      }
      if (s.legacy.length > 0) {
        this.section(list, `Unclaimed from v0.1.0: ${s.legacy.length} files`, s.legacy, filter, false,
          "Uploaded before per-vault namespaces and not adopted by any vault. Safe to ignore.");
      }
      if (s.meta.length > 0) {
        this.section(list, `Sync metadata: ${s.meta.length} files`, s.meta, filter, false);
      }
    };
    draw();
  }

  private section(
    parent: HTMLElement,
    title: string,
    files: RemoteEntry[],
    filter: string,
    open: boolean,
    note?: string,
  ): void {
    const shown = filter ? files.filter((f) => f.path.toLowerCase().includes(filter)) : files;
    if (filter && shown.length === 0) return;

    const details = parent.createEl("details");
    details.open = open || !!filter;
    details.createEl("summary", { text: filter ? `${title} (${shown.length} match)` : title });
    if (note) details.createEl("p", { text: note, cls: "setting-item-description" });

    const table = details.createEl("table");
    table.style.width = "100%";
    table.style.fontSize = "var(--font-ui-smaller)";
    for (const f of shown.slice(0, MAX_ROWS)) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: f.path }).style.wordBreak = "break-all";
      const size = tr.createEl("td", { text: formatBytes(f.size) });
      size.style.textAlign = "right";
      size.style.whiteSpace = "nowrap";
      const when = tr.createEl("td", {
        text: f.modifiedTime ? new Date(f.modifiedTime).toLocaleString() : "",
      });
      when.style.whiteSpace = "nowrap";
      when.style.paddingLeft = "1em";
    }
    if (shown.length > MAX_ROWS) {
      details.createEl("p", {
        text: `…and ${shown.length - MAX_ROWS} more. Use the filter to narrow the list.`,
        cls: "setting-item-description",
      });
    }
  }
}
