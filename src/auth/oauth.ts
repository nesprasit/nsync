import { requestUrl } from "obsidian";
import type { OAuthClient } from "./client";

// Google OAuth via PKCE.
// - Desktop: loopback redirect (http://127.0.0.1:42813).
// - Mobile:  https bridge page -> obsidian://nsync-auth callback.
//
// Each user brings their own Google Cloud OAuth client ("Web application", the
// only type that can register both redirect URIs). Google requires the
// client_secret at token exchange for web clients, so it is sent along with
// PKCE; it comes from the user's settings and is never bundled in the plugin.

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

export function buildAuthUrl(
  client: OAuthClient,
  challenge: string,
  redirectUri: string,
  stateNonce: string,
): string {
  const p = new URLSearchParams({
    client_id: client.clientId,
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
  client: OAuthClient,
  code: string,
  verifier: string,
  redirect: string,
): Promise<TokenSet> {
  const json = await postToken({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirect,
  });
  return toTokenSet(json);
}

export async function refresh(client: OAuthClient, refreshToken: string): Promise<TokenSet> {
  const json = await postToken({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const t = toTokenSet(json);
  // Google may omit refresh_token on refresh; keep the old one.
  if (!t.refreshToken) t.refreshToken = refreshToken;
  return t;
}

/** Google's token endpoint response (success or error fields). */
interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** POST to the token endpoint, surfacing Google's error text (e.g. invalid_client). */
async function postToken(params: Record<string, string>): Promise<TokenBody> {
  const res = await requestUrl({
    url: TOKEN_ENDPOINT,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams(params).toString(),
    throw: false,
  });
  let body: TokenBody = {};
  try {
    body = res.json as TokenBody;
  } catch {
    // non-JSON body; fall through with the status code
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = body.error_description
      ? `${body.error ?? "error"}: ${body.error_description}`
      : body.error ?? String(res.status);
    throw new Error(`Google token request failed (${detail})`);
  }
  return body;
}

function toTokenSet(body: TokenBody): TokenSet {
  if (!body.access_token) throw new Error("Google token response had no access token");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? "",
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
