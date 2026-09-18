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
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null; // not JSON; treat as a plain Client ID
  }
  if (!isObject(parsed)) return null;
  const inner = isObject(parsed.web) ? parsed.web : isObject(parsed.installed) ? parsed.installed : parsed;
  const id = inner.client_id;
  const secret = inner.client_secret;
  if (typeof id === "string" && typeof secret === "string") {
    return normalizeClient({ clientId: id, clientSecret: secret });
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
