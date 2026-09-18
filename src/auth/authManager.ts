import { Platform, type ObsidianProtocolData } from "obsidian";
import {
  buildAuthUrl,
  createPkcePair,
  exchangeCode,
  type TokenSet,
} from "./oauth";
import { clientProblem, type OAuthClient } from "./client";

// Node is available on desktop only. Never import it statically: the bundle
// would `require("http")` at load and crash Obsidian mobile. We require it
// lazily inside the desktop-only branch instead (the type import is erased).
type NodeHttp = typeof import("http");
declare const require: (mod: string) => unknown;

const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 42813;
export const LOOPBACK_REDIRECT = `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`;

/** obsidian:// action the mobile https bridge must redirect to. */
export const MOBILE_CALLBACK_ACTION = "nsync-auth";
export const MOBILE_CALLBACK_URL = `obsidian://${MOBILE_CALLBACK_ACTION}`;

/** A mobile sign-in waiting for its obsidian:// callback. */
export interface PendingAuth {
  verifier: string;
  state: string;
  redirect: string;
  createdAt: number;
}

/**
 * Where the pending mobile sign-in is kept. It must survive the app being
 * suspended or reloaded while the user is in Safari, so it can't live only in
 * memory.
 */
export interface PendingAuthStore {
  load(): Promise<PendingAuth | null>;
  save(p: PendingAuth | null): Promise<void>;
}

const PENDING_TTL_MS = 15 * 60_000;

export class AuthManager {
  /**
   * @param openExternal opens a URL in the system browser.
   * @param mobileBridge the https page that forwards ?code&state to
   *   obsidian://nsync-auth (required on mobile only).
   * @param pending persistence for the in-flight mobile sign-in.
   * @param getClient the user's own OAuth client from settings.
   */
  constructor(
    private readonly openExternal: (url: string) => void,
    private readonly mobileBridge: () => string,
    private readonly pending: PendingAuthStore,
    private readonly getClient: () => OAuthClient,
  ) {}

  /** The configured client, or an error telling the user what's missing. */
  private client(): OAuthClient {
    const c = this.getClient();
    const problem = clientProblem(c);
    if (problem) throw new Error(problem);
    return c;
  }

  /**
   * Desktop: resolves with the token once the loopback receives the code.
   * Mobile: opens the browser and resolves null; the token arrives later via
   * completeMobile() when obsidian://nsync-auth fires.
   */
  async signIn(): Promise<TokenSet | null> {
    this.client(); // fail fast, before opening a browser
    const { verifier, challenge } = await createPkcePair();
    const state = crypto.randomUUID();
    if (Platform.isMobile) {
      await this.startMobile(verifier, challenge, state);
      return null;
    }
    return this.signInDesktop(verifier, challenge, state);
  }

  // --- desktop: one-shot loopback server ---------------------------------

  private signInDesktop(verifier: string, challenge: string, state: string): Promise<TokenSet> {
    return new Promise<TokenSet>((resolve, reject) => {
      // Desktop only (signIn routes mobile elsewhere): a one-shot local server is
      // the OAuth loopback redirect Google supports for installed apps.
      const http = Platform.isDesktop ? (require("http") as NodeHttp) : null;
      if (!http) {
        reject(new Error("Desktop sign-in isn't available on this device."));
        return;
      }

      const finish = (req: { url?: string }): void => {
        const url = new URL(req.url ?? "/", LOOPBACK_REDIRECT);
        const code = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        if (err) return reject(new Error(`Google returned error: ${err}`));
        if (!code) return reject(new Error("No authorization code returned"));
        if (url.searchParams.get("state") !== state) {
          return reject(new Error("State mismatch (possible CSRF)"));
        }
        exchangeCode(this.client(), code, verifier, LOOPBACK_REDIRECT).then(resolve, reject);
      };

      const server = http.createServer((req, res) => {
        if (new URL(req.url ?? "/", LOOPBACK_REDIRECT).pathname !== "/") {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><meta charset=utf-8><body style='font-family:sans-serif'>Signed in. You can close this tab and return to Obsidian.</body>");
        server.close();
        try {
          finish(req);
        } catch (e) {
          reject(toError(e));
        }
      });
      server.on("error", (e) => reject(e));
      server.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => {
        try {
          this.openExternal(buildAuthUrl(this.client(), challenge, LOOPBACK_REDIRECT, state));
        } catch (e) {
          server.close();
          reject(toError(e));
        }
      });
      window.setTimeout(() => {
        server.close();
        reject(new Error("Sign-in timed out"));
      }, 180_000);
    });
  }

  // --- mobile: https bridge -> obsidian:// callback ----------------------

  private async startMobile(verifier: string, challenge: string, state: string): Promise<void> {
    const redirect = this.mobileBridge().trim();
    if (!redirect) throw new Error("Set the mobile redirect bridge URL in settings first.");
    // Persist before leaving the app: iOS may reload Obsidian while in Safari.
    await this.pending.save({ verifier, state, redirect, createdAt: Date.now() });
    this.openExternal(buildAuthUrl(this.client(), challenge, redirect, state));
  }

  /** Called by main.ts when obsidian://nsync-auth fires. Returns the new token. */
  async completeMobile(params: ObsidianProtocolData): Promise<TokenSet> {
    const p = await this.pending.load();
    if (!p) throw new Error("No sign-in in progress. Tap Sign in again.");
    await this.pending.save(null); // single use
    if (Date.now() - p.createdAt > PENDING_TTL_MS) {
      throw new Error("Sign-in expired. Tap Sign in again.");
    }
    if (params.error) throw new Error(`Google returned error: ${params.error}`);
    if (!params.code) throw new Error("No authorization code returned");
    if (params.state !== p.state) throw new Error("State mismatch (possible CSRF)");
    return exchangeCode(this.client(), params.code, p.verifier, p.redirect);
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
