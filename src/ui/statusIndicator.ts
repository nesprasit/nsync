import { setIcon, setTooltip } from "obsidian";

// Status bar item: a cloud icon whose shape/colour tracks the sync state, plus
// a short label. Desktop only in practice (Obsidian mobile has no status bar).

export type SyncStatus = "idle" | "syncing" | "ok" | "attention" | "error" | "signed-out";

const ICON: Record<SyncStatus, string> = {
  idle: "cloud",
  syncing: "refresh-cw",
  ok: "cloud",
  attention: "alert-circle", // e.g. first sync waiting for review
  error: "cloud-off",
  "signed-out": "cloud-off",
};

// Styling lives in styles.css (.nsync-status*), which Obsidian loads itself.

export class StatusIndicator {
  private readonly icon: HTMLElement;
  private readonly label: HTMLElement;
  private current: SyncStatus | null = null;

  constructor(private readonly el: HTMLElement) {
    el.addClass("nsync-status", "mod-clickable");
    this.icon = el.createSpan({ cls: "nsync-status-icon" });
    this.label = el.createSpan({ cls: "nsync-status-text" });
  }

  set(state: SyncStatus, label: string, tooltip: string): void {
    if (state !== this.current) {
      // Swap the icon only on a state change, so the spinner isn't restarted
      // on every progress tick.
      this.el.dataset.state = state;
      setIcon(this.icon, ICON[state]);
      this.current = state;
    }
    this.label.setText(label);
    setTooltip(this.el, tooltip, { placement: "top" });
  }
}
