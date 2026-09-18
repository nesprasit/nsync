import { requestUrl } from "obsidian";
// Credentials live in credentials.ts (gitignored). The OAuth client is of type
// "Web application" — the only type that lets one client register both the
// desktop loopback and the mobile https bridge redirect URIs — and Google forces
// client_secret at token exchange for web clients. PKCE still guards against
// code interception. Never sync credentials.ts / data.json to Drive.
import { CLIENT_ID, CLIENT_SECRET } from "./credentials";

// Google OAuth via PKCE.
// - Desktop: loopback redirect (http://127.0.0.1:42813).
// - Mobile:  https bridge page -> obsidian://nsync-auth callback.
// Each user signs in with their own Google account, so files never mix; the
// Client ID only identifies the app (Q20 = single shared client id).

export { CLIENT_ID, CLIENT_SECRET };
export const SCOPE = "https://www.googleapis.com/auth/drive.appdata";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when accessToken expires */
  expiresAt: number;
}

// --- PKCE helpers ---------------------------------------------------------

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function buildAuthUrl(challenge: string, redirectUri: string, stateNonce: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state: stateNonce,
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

// Redirect URIs live in authManager.ts: loopback on desktop, the https bridge
// on mobile.

// --- token exchange -------------------------------------------------------

export async function exchangeCode(
  code: string,
  verifier: string,
  redirect: string,
): Promise<TokenSet> {
  const res = await requestUrl({
    url: TOKEN_ENDPOINT,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirect,
    }).toString(),
  });
  return toTokenSet(res.json);
}

export async function refresh(refreshToken: string): Promise<TokenSet> {
  const res = await requestUrl({
    url: TOKEN_ENDPOINT,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const t = toTokenSet(res.json);
  // Google may omit refresh_token on refresh; keep the old one.
  if (!t.refreshToken) t.refreshToken = refreshToken;
  return t;
}

function toTokenSet(json: any): TokenSet {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
