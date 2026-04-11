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

// ── OAuth loopback (two-step API) ────────────────────────────────────

export interface LoopbackHandle {
  /** Stable id used to wait for or cancel this listener. */
  id: number;
  /** The 127.0.0.1 URL the listener is bound to. Pass this to the OAuth
   * provider as `redirect_uri` when opening the authorize URL. */
  redirectUri: string;
}

export interface LoopbackResult {
  redirectUri: string;
  code: string | null;
  error: string | null;
  state: string | null;
}

/**
 * Step 1 of the OAuth loopback flow.
 *
 * Reserves a free 127.0.0.1 port via the Tauri shell and returns the bound
 * URI synchronously. The caller can then construct the provider's authorize
 * URL with this URI as `redirect_uri` and open the system browser. No race
 * — the listener is guaranteed to be bound by the time this resolves.
 */
export async function oauthLoopbackStart(): Promise<LoopbackHandle> {
  const result = await invoke<{ id: number; redirect_uri: string }>(
    "oauth_loopback_start",
  );
  return { id: result.id, redirectUri: result.redirect_uri };
}

/**
 * Step 2 of the OAuth loopback flow.
 *
 * Blocks until the previously-started listener receives a redirect from the
 * provider, the timeout elapses, or `oauthLoopbackCancel(id)` is called.
 * The listener is consumed on resolution — call `oauthLoopbackStart` again
 * to start another flow.
 */
export async function oauthLoopbackWait(
  handle: LoopbackHandle,
  timeoutSecs = 180,
): Promise<LoopbackResult> {
  const result = await invoke<{
    redirect_uri: string;
    code: string | null;
    error: string | null;
    state: string | null;
  }>("oauth_loopback_wait", { id: handle.id, timeoutSecs });

  return {
    redirectUri: result.redirect_uri,
    code: result.code,
    error: result.error,
    state: result.state,
  };
}

/**
 * Cancel an in-flight loopback listener (e.g. user clicked Cancel in the
 * connectors UI). The corresponding `oauthLoopbackWait` call will reject
 * with a "listener was cancelled" error on its next poll iteration.
 *
 * Returns `true` if a listener was cancelled, `false` if the id is unknown.
 */
export async function oauthLoopbackCancel(id: number): Promise<boolean> {
  return invoke<boolean>("oauth_loopback_cancel", { id });
}

// ── High-level connector flows ───────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export interface ConnectGoogleOptions {
  timeoutSecs?: number;
  /**
   * Called immediately after the loopback listener is bound, with the
   * handle. The caller can stash the id to support cancellation via
   * `oauthLoopbackCancel(handle.id)` if the user navigates away or hits
   * Escape before the OAuth round-trip completes.
   */
  onStart?: (handle: LoopbackHandle) => void;
}

/**
 * End-to-end Google OAuth flow for the desktop app.
 *
 *   1. Start the loopback listener (gets the bound redirect URI synchronously).
 *   2. Build the Google authorize URL with that redirect URI.
 *   3. Open the URL in the user's default browser.
 *   4. Wait for the listener to receive the redirect and capture the auth code.
 *   5. POST the code to `/api/connectors/google/exchange`, which performs the
 *      token exchange server-side so `client_secret` never leaves the Next.js
 *      process, and persists into the local PGlite brain.
 *   6. Mirror the refresh token into the macOS Keychain.
 *
 * No race because of the two-step API: the listener is bound before the
 * browser ever opens. Cancellable mid-flight via `onStart` + `oauthLoopbackCancel`.
 */
export async function connectGoogleViaLoopback(
  clientId: string,
  options: ConnectGoogleOptions = {},
): Promise<{ refreshToken: string | null }> {
  if (!isTauri()) {
    throw new Error("connectGoogleViaLoopback requires the Tauri shell");
  }
  if (!clientId) {
    throw new Error("missing Google OAuth client_id");
  }

  // 1. Bind the loopback listener — returns synchronously with the URI.
  const handle = await oauthLoopbackStart();
  options.onStart?.(handle);

  // 2 + 3. Build the authorize URL and open it in the system browser.
  const authorizeUrl = buildGoogleAuthorizeUrl(clientId, handle.redirectUri);
  if (typeof window !== "undefined") {
    window.open(authorizeUrl, "_blank");
  }

  // 4. Wait for the redirect.
  const result = await oauthLoopbackWait(handle, options.timeoutSecs ?? 300);
  if (result.error) {
    throw new Error(`google oauth error: ${result.error}`);
  }
  if (!result.code) {
    throw new Error("google oauth completed without a code");
  }

  // 5. Exchange the code server-side.
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

  const body = (await exchangeResponse.json()) as { refresh_token?: string };

  // 6. Mirror into the keychain.
  if (body.refresh_token) {
    await keychainSet("google", "refresh_token", body.refresh_token);
  }

  return { refreshToken: body.refresh_token ?? null };
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
