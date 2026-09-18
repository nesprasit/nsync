import { type App, Modal, Notice } from "obsidian";

// Mobile sign-in launcher. iOS only opens the system browser from a direct user
// tap; by the time the async PKCE setup finishes, a programmatic window.open()
// is no longer "user initiated" and is silently dropped. So on mobile we show
// this modal and let the tap itself open the URL. A plain link and a copy
// button are fallbacks.

export class SignInLinkModal extends Modal {
  constructor(app: App, private readonly url: string) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("NSync: sign in with Google");
    contentEl.createEl("p", {
      text:
        "Tap the button to open Google sign-in in your browser. After you allow " +
        "access you'll be sent back to Obsidian automatically.",
    });

    const open = contentEl.createEl("button", { text: "Open Google sign-in", cls: "mod-cta" });
    open.style.width = "100%";
    open.addEventListener("click", () => {
      window.open(this.url, "_blank"); // synchronous, inside the tap
      this.close();
    });

    const alt = contentEl.createEl("p", { cls: "setting-item-description" });
    alt.appendText("If nothing opens, ");
    alt.createEl("a", { text: "tap this link", href: this.url });
    alt.appendText(" or copy it into Safari/Chrome:");

    const copy = contentEl.createEl("button", { text: "Copy link" });
    copy.style.width = "100%";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.url);
        new Notice("NSync: sign-in link copied. Paste it into your browser.");
      } catch {
        new Notice("NSync: couldn't copy. Use the link above instead.");
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
