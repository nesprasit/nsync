import { Notice } from "obsidian";

// One place for the plugin's name in user-facing messages, so every notice is
// prefixed the same way and the brand is spelled consistently.

export const PLUGIN_NAME = "NSync";

/** Show a notice prefixed with the plugin name. duration 0 keeps it until hidden. */
export function notify(message: string, duration?: number): Notice {
  return new Notice(`${PLUGIN_NAME}: ${message}`, duration);
}

/** Replace the text of a notice created by notify(), keeping the prefix. */
export function updateNotice(notice: Notice, message: string): void {
  notice.setMessage(`${PLUGIN_NAME}: ${message}`);
}
