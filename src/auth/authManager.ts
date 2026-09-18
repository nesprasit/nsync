import { Platform, type ObsidianProtocolData } from "obsidian";
import {
  buildAuthUrl,
  createPkcePair,
  exchangeCode,
  type TokenSet,
} from "./oauth";

// Node/Electron are available on desktop only. Never import them statically —
// the bundle would `require("http")` at load and crash Obsidian mobile. We
// require lazily inside desktop-only branches instead.
declare const require: (mod: string) => any;

const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 42813;
export const LOOPBACK_REDIRECT = `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`;

/** obsidian:// action the mobile https bridge must redirect to. */
export const MOBILE_CALLBACK_ACTION = "nsync-auth";
export const MOBILE_CALLBACK_URL = `obsidian://${MOBILE_CALLBACK_ACTION}`;

interface PendingMobile {
  verifier: string;
  state: string;
  redirect: string;
  resolve: (t: TokenSet) => void;
  reject: (e: Error) => void;
}

export class AuthManager {
  private pendingMobile: PendingMobile | null = null;

  /**
   * @param openExternal opens a URL in the system browser.
   * @param mobileBridge the https page that forwards ?code&state to
   *   obsidian://nsync-auth (required on mobile only).
   */
  constructor(
    private readonly openExternal: (url: string) => void,
    private readonly mobileBridge: () => string,
  ) {}

  async signIn(): Promise<TokenSet> {
    const { verifier, challenge } = await createPkcePair();
    const state = crypto.randomUUID();
    return Platform.isMobile
      ? this.signInMobile(verifier, challenge, state)
      : this.signInDesktop(verifier, challenge, state);
  }

  // --- desktop: one-shot loopback server ---------------------------------

  private signInDesktop(verifier: string, challenge: string, state: string): Promise<TokenSet> {
    return new Promise<TokenSet>((resolve, reject) => {
      const http = require("http");
      const server = http.createServer(async (req: any, res: any) => {
        try {
          const url = new URL(req.url, LOOPBACK_REDIRECT);
          if (url.pathname !== "/") {
            res.writeHead(404).end();
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<!doctype html><meta charset=utf-8><body style='font-family:sans-serif'>Signed in. You can close this tab and return to Obsidian.</body>");
          server.close();
          const code = url.searchParams.get("code");
          const gotState = url.searchParams.get("state");
          const err = url.searchParams.get("error");
          if (err) return reject(new Error(`Google returned error: ${err}`));
          if (!code) return reject(new Error("No authorization code returned"));
          if (gotState !== state) return reject(new Error("State mismatch (possible CSRF)"));
          resolve(await exchangeCode(code, verifier, LOOPBACK_REDIRECT));
        } catch (e) {
          reject(e as Error);
        }
      });
      server.on("error", (e: Error) => reject(e));
      server.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => {
        this.openExternal(buildAuthUrl(challenge, LOOPBACK_REDIRECT, state));
      });
      setTimeout(() => {
        try { server.close(); } catch { /* already closed */ }
        reject(new Error("Sign-in timed out"));
      }, 180_000);
    });
  }

  // --- mobile: https bridge -> obsidian:// callback ----------------------

  private signInMobile(verifier: string, challenge: string, state: string): Promise<TokenSet> {
    const redirect = this.mobileBridge().trim();
    if (!redirect) {
      return Promise.reject(
        new Error("Set the mobile redirect bridge URL in settings first."),
      );
    }
    return new Promise<TokenSet>((resolve, reject) => {
      this.pendingMobile = { verifier, state, redirect, resolve, reject };
      this.openExternal(buildAuthUrl(challenge, redirect, state));
      setTimeout(() => {
        if (this.pendingMobile) {
          this.pendingMobile.reject(new Error("Sign-in timed out"));
          this.pendingMobile = null;
        }
      }, 300_000);
    });
  }

  /** Called by main.ts when obsidian://nsync-auth fires. */
  async handleMobileCallback(params: ObsidianProtocolData): Promise<void> {
    const p = this.pendingMobile;
    if (!p) return;
    this.pendingMobile = null;
    try {
      if (params.error) throw new Error(`Google returned error: ${params.error}`);
      if (!params.code) throw new Error("No authorization code returned");
      if (params.state !== p.state) throw new Error("State mismatch (possible CSRF)");
      p.resolve(await exchangeCode(params.code, p.verifier, p.redirect));
    } catch (e) {
      p.reject(e as Error);
    }
  }
}
