import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface ExchangeRequest {
  code: string;
  redirect_uri: string;
}

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

  // Get the authenticated user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // For individual mode, we persist the refresh_token under the canonical
  // `tokens` JSONB shape that `loadCredentials` reads first.
  const tokensBlob: Record<string, string> = {};
  if (tokens.refresh_token) {
    tokensBlob.GMAIL_CLIENT_ID = clientId;
    tokensBlob.GMAIL_CLIENT_SECRET = clientSecret;
    tokensBlob.GMAIL_REFRESH_TOKEN = tokens.refresh_token;
    tokensBlob.CALENDAR_CLIENT_ID = clientId;
    tokensBlob.CALENDAR_CLIENT_SECRET = clientSecret;
    tokensBlob.CALENDAR_REFRESH_TOKEN = tokens.refresh_token;
  }

  const { error: upsertError } = await supabase
    .from("connector_tokens")
    .upsert(
      {
        user_id: user.id,
        organization_id: user.app_metadata.organization_id || user.id,
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
