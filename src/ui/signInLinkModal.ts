import { type App, Modal } from "obsidian";
import { notify, PLUGIN_NAME } from "./notify";

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
    this.titleEl.setText(`${PLUGIN_NAME}: sign in with Google`);
    contentEl.createEl("p", {
      text:
        "Tap the button to open Google sign-in in your browser. After you allow " +
        "access you'll be sent back to Obsidian automatically.",
    });

    const open = contentEl.createEl("button", {
      text: "Open Google sign-in",
      cls: ["mod-cta", "nsync-full-width"],
    });
    open.addEventListener("click", () => {
      window.open(this.url, "_blank"); // synchronous, inside the tap
      this.close();
    });

    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "If nothing opens, tap the link below or copy it into your browser.",
    });
    contentEl.createEl("p").createEl("a", { text: "Google sign-in link", href: this.url });

    const copy = contentEl.createEl("button", { text: "Copy link", cls: "nsync-full-width" });
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(this.url).then(
        () => notify("sign-in link copied. Paste it into your browser."),
        () => notify("couldn't copy. Use the link above instead."),
      );
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
