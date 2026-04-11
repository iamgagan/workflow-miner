import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDesktopMode } from "@/lib/supabase/local-shim";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ExchangeRequest {
  code: string;
  redirect_uri: string;
}

/**
 * Exchange a Google OAuth authorization code for tokens, then store them in
 * the local PGlite brain (desktop mode) or Supabase (hosted mode).
 *
 * Used by the desktop OAuth loopback flow:
 *   1. The Tauri shell opens a loopback listener and the browser navigates
 *      to Google's authorize URL with the loopback redirect_uri.
 *   2. Google redirects back to the loopback with `?code=...`.
 *   3. The renderer captures the code and POSTs it here.
 *   4. We exchange code → tokens server-side (so the client_secret stays in
 *      the Next.js process) and persist the result.
 *
 * Returns `{ refresh_token, scopes }` so the renderer can mirror the
 * refresh_token into the macOS Keychain for redundancy.
 */
export async function POST(request: NextRequest) {
  let body: ExchangeRequest;
  try {
    body = (await request.json()) as ExchangeRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.code || !body.redirect_uri) {
    return NextResponse.json(
      { error: "missing_code_or_redirect_uri" },
      { status: 400 },
    );
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "server_oauth_not_configured" },
      { status: 500 },
    );
  }

  // Exchange the code for tokens.
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: body.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: body.redirect_uri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text();
    console.error("[google/exchange] token exchange failed", detail);
    return NextResponse.json(
      { error: "token_exchange_failed", detail },
      { status: 502 },
    );
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };

  // Persist into connector_tokens. In desktop mode this hits the local PGlite
  // database; in hosted mode it goes through the Supabase service-role client.
  const client = createAdminClient();
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // For desktop mode we also persist the refresh_token under the canonical
  // `tokens` JSONB shape that `loadCredentials` reads first.
  const tokensBlob: Record<string, string> = {};
  if (isDesktopMode() && tokens.refresh_token) {
    tokensBlob.GMAIL_CLIENT_ID = clientId;
    tokensBlob.GMAIL_CLIENT_SECRET = clientSecret;
    tokensBlob.GMAIL_REFRESH_TOKEN = tokens.refresh_token;
    tokensBlob.CALENDAR_CLIENT_ID = clientId;
    tokensBlob.CALENDAR_CLIENT_SECRET = clientSecret;
    tokensBlob.CALENDAR_REFRESH_TOKEN = tokens.refresh_token;
  }

  const userId = "local";
  const { error: upsertError } = await client
    .from("connector_tokens")
    .upsert(
      {
        user_id: userId,
        provider: "google",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        token_type: tokens.token_type ?? "Bearer",
        expires_at: expiresAt,
        scopes: tokens.scope ?? "",
        tokens: tokensBlob,
        metadata: { token_type: tokens.token_type ?? "Bearer" },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );

  if (upsertError) {
    console.error("[google/exchange] failed to persist tokens", upsertError);
    return NextResponse.json(
      { error: "persist_failed", detail: upsertError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    refresh_token: tokens.refresh_token ?? null,
    scope: tokens.scope ?? "",
    expires_at: expiresAt,
  });
}
