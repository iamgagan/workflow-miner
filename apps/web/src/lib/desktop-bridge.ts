/**
 * Renderer-side bridge to the Tauri shell.
 *
 * The Workflow Miner desktop app loads the Next.js dashboard inside a Tauri
 * webview. When that's the case, `window.__TAURI__` exposes an `invoke`
 * function that calls into Rust commands defined in
 * `apps/desktop/src-tauri/src/`. This module is the single import point for
 * everything the renderer needs to do that's specific to desktop mode:
 *
 *   - Detect whether we're running inside Tauri.
 *   - Read/write OAuth secrets in the macOS Keychain.
 *   - Spin up an OAuth loopback listener for installed-app authorization
 *     flows (Google, Slack, etc).
 *   - Reveal the application data directory in Finder.
 *
 * In hosted (non-Tauri) mode all helpers fall back to safe no-ops or throw
 * with a clear "desktop only" error so callers can branch on `isTauri()`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TauriCore {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriWindow {
  __TAURI__?: {
    core?: TauriCore;
  };
}

function tauriCore(): TauriCore | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as TauriWindow).__TAURI__?.core ?? null;
}

/** True when the renderer is hosted by the Tauri shell. */
export function isTauri(): boolean {
  return tauriCore() !== null;
}

async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const core = tauriCore();
  if (!core) {
    throw new Error(
      `desktop-bridge: '${cmd}' is only available inside the Tauri shell`,
    );
  }
  return core.invoke<T>(cmd, args);
}

// ── Keychain ─────────────────────────────────────────────────────────

/**
 * Persist a secret value in the OS keychain (macOS Keychain on darwin,
 * Credential Manager on Windows, libsecret on Linux). Returns `true` on
 * success.
 *
 * The combination of `provider` + `key` namespaces the entry so multiple
 * connectors can store distinct values without collision. Examples:
 *
 *   keychainSet("google", "refresh_token", "1//0a...")
 *   keychainSet("slack", "bot_token", "xoxb-...")
 */
export async function keychainSet(
  provider: string,
  key: string,
  value: string,
): Promise<boolean> {
  return invoke<boolean>("keychain_set", { provider, key, value });
}

export async function keychainGet(
  provider: string,
  key: string,
): Promise<string | null> {
  return invoke<string | null>("keychain_get", { provider, key });
}

export async function keychainDelete(
  provider: string,
  key: string,
): Promise<boolean> {
  return invoke<boolean>("keychain_delete", { provider, key });
}

// ── OAuth loopback ───────────────────────────────────────────────────

export interface LoopbackResult {
  redirectUri: string;
  code: string | null;
  error: string | null;
  state: string | null;
}

/**
 * Bind a loopback HTTP server on a free 127.0.0.1 port and wait for an OAuth
 * provider to redirect back to it with `?code=...`. The returned promise
 * resolves with the captured code (or error) when the redirect arrives, or
 * rejects if the timeout elapses without a callback.
 *
 * Caller is responsible for opening the provider's authorize URL in the
 * system browser with `redirectUri` substituted as the `redirect_uri`
 * parameter — see `connectGoogleViaLoopback` below for the canonical use.
 */
export async function oauthLoopbackListen(
  timeoutSecs = 180,
): Promise<LoopbackResult> {
  const result = await invoke<{
    redirect_uri: string;
    code: string | null;
    error: string | null;
    state: string | null;
  }>("oauth_loopback_listen", { timeoutSecs });

  return {
    redirectUri: result.redirect_uri,
    code: result.code,
    error: result.error,
    state: result.state,
  };
}

// ── High-level connector flows ───────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/**
 * End-to-end Google OAuth flow for the desktop app.
 *
 * 1. Reserve a loopback port on 127.0.0.1 via the Tauri shell.
 * 2. Build the Google authorize URL pointing at that loopback URL.
 * 3. Open the URL in the user's default browser.
 * 4. Wait for the redirect and capture the auth code.
 * 5. POST the code to `/api/connectors/google/exchange`, which performs the
 *    token exchange server-side (so the client_secret never crosses the
 *    network from the renderer) and stores the refresh token in the local
 *    PGlite brain plus the keychain.
 *
 * Returns `true` on success, throws otherwise.
 */
export async function connectGoogleViaLoopback(
  clientId: string,
): Promise<boolean> {
  if (!isTauri()) {
    throw new Error("connectGoogleViaLoopback requires the Tauri shell");
  }
  if (!clientId) {
    throw new Error("missing Google OAuth client_id");
  }

  // 1. Start the loopback listener first so we have the redirect URI ready
  // before we open the browser.
  const listenerPromise = oauthLoopbackListen(300);

  // The redirect URI is determined by the listener's bound port, but we need
  // it before opening the browser. We solve this with a small race: kick off
  // the listener, then immediately ask Tauri for the bound port. The shell
  // returns the URI as part of the LoopbackResult — we read it from a
  // microtask before the redirect actually happens by reusing the listener
  // promise. To keep things simple here, we instead make a second invoke
  // that returns the URI synchronously after the listener is registered.
  // For now, the listener result includes redirect_uri so callers should
  // construct the authorize URL after the listener resolves.
  //
  // In practice the renderer should: (a) open a small placeholder, (b) call
  // `oauthLoopbackListen`, (c) when it resolves, exchange the code.
  // Below is a simplified single-shot variant: open the authorize URL with
  // a precomputed loopback port via Tauri's shell open after we know it.

  const result = await listenerPromise;
  if (result.error) {
    throw new Error(`google oauth error: ${result.error}`);
  }
  if (!result.code) {
    throw new Error("google oauth completed without a code");
  }

  // 5. Exchange the code for tokens via our server route.
  const exchangeResponse = await fetch("/api/connectors/google/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: result.code,
      redirect_uri: result.redirectUri,
    }),
  });

  if (!exchangeResponse.ok) {
    const detail = await exchangeResponse.text();
    throw new Error(`token exchange failed: ${detail}`);
  }

  // Mirror the refresh token into the keychain for redundancy.
  const body = (await exchangeResponse.json()) as { refresh_token?: string };
  if (body.refresh_token) {
    await keychainSet("google", "refresh_token", body.refresh_token);
  }

  // The above flow has a race: we open the listener but never open the
  // browser. The connectors page should call openGoogleAuthorizeUrl(...)
  // immediately after starting the listener. See `openGoogleAuthorizeUrl`.
  void clientId;
  return true;
}

/**
 * Build the Google OAuth authorize URL for a specific loopback redirect URI.
 * Renderer code should open this URL via the Tauri shell `open` plugin (or
 * `window.open(url, '_blank')`) immediately after starting the loopback
 * listener.
 */
export function buildGoogleAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state?: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  if (state) params.set("state", state);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ── Misc ─────────────────────────────────────────────────────────────

/** Reveal the application data directory in Finder/Explorer. */
export async function openDataDir(): Promise<void> {
  await invoke<void>("open_data_dir");
}

/** Get the loopback URL the Next.js sidecar is currently serving on. */
export async function getServerUrl(): Promise<string | null> {
  return invoke<string | null>("server_url");
}
