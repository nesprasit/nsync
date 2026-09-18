// The user's own Google Cloud OAuth client ("bring your own credentials").
// Pure helpers (no Obsidian imports) so they are unit-testable.

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

const ID_SUFFIX = ".apps.googleusercontent.com";

export function normalizeClient(c: Partial<OAuthClient>): OAuthClient {
  return { clientId: (c.clientId ?? "").trim(), clientSecret: (c.clientSecret ?? "").trim() };
}

/** Returns a user-facing problem with the client, or null when it looks usable. */
export function clientProblem(c: Partial<OAuthClient>): string | null {
  const { clientId, clientSecret } = normalizeClient(c);
  if (!clientId || !clientSecret) {
    return "Enter your Google OAuth Client ID and Client secret in NSync settings first.";
  }
  if (!clientId.endsWith(ID_SUFFIX)) {
    return `The Client ID should end with ${ID_SUFFIX}`;
  }
  return null;
}

/**
 * Accepts either a bare Client ID or the JSON file Google Cloud lets you
 * download for the client ({"web": {"client_id", "client_secret", ...}}).
 * Returns the parsed client when the input is that JSON, else null.
 */
export function parseClientJson(input: string): OAuthClient | null {
  const s = input.trim();
  if (!s.startsWith("{")) return null;
  try {
    const j = JSON.parse(s);
    const inner = j.web ?? j.installed ?? j;
    if (typeof inner.client_id === "string" && typeof inner.client_secret === "string") {
      return normalizeClient({ clientId: inner.client_id, clientSecret: inner.client_secret });
    }
  } catch {
    // not JSON; treat as a plain Client ID
  }
  return null;
}
