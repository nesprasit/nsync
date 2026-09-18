import { setIcon, setTooltip } from "obsidian";

// Status bar item: a cloud icon whose shape/colour tracks the sync state, plus
// a short label. Desktop only in practice (Obsidian mobile has no status bar).

export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "signed-out";

const ICON: Record<SyncStatus, string> = {
  idle: "cloud",
  syncing: "refresh-cw",
  ok: "cloud",
  error: "cloud-off",
  "signed-out": "cloud-off",
};

// Injected at load so installs stay two files (main.js + manifest.json).
export const STATUS_CSS = `
.nsync-status { display: inline-flex; align-items: center; gap: 4px; }
.nsync-status-icon { display: inline-flex; }
.nsync-status-icon svg { width: var(--icon-xs, 14px); height: var(--icon-xs, 14px); }
.nsync-status[data-state="ok"] .nsync-status-icon { color: var(--color-green); }
.nsync-status[data-state="syncing"] .nsync-status-icon { color: var(--interactive-accent); }
.nsync-status[data-state="syncing"] .nsync-status-icon svg { animation: nsync-spin 1s linear infinite; }
.nsync-status[data-state="error"] { color: var(--text-error); }
.nsync-status[data-state="signed-out"] { color: var(--text-faint); }
@keyframes nsync-spin { to { transform: rotate(360deg); } }
`;

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
