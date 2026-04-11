import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/connectors?error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/connectors?error=missing_code`
    );
  }

  // Exchange authorization code for tokens
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${appUrl}/connectors?error=server_config`
    );
  }

  const redirectUri = `${appUrl}/api/connectors/google/callback`;

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    console.error("Google token exchange failed:", body);
    return NextResponse.redirect(
      `${appUrl}/connectors?error=token_exchange`
    );
  }

  const tokens = await tokenResponse.json();

  // Get authenticated user from Supabase
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.redirect(
      `${appUrl}/login?error=not_authenticated`
    );
  }

  // Upsert tokens into connector_tokens using service role client
  const admin = createAdminClient();
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  const { error: upsertError } = await admin
    .from("connector_tokens")
    .upsert(
      {
        user_id: user.id,
        provider: "google",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        token_type: tokens.token_type ?? "Bearer",
        expires_at: expiresAt,
        scopes: tokens.scope ?? "",
        metadata: { token_type: tokens.token_type },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );

  if (upsertError) {
    console.error("Failed to store connector tokens:", upsertError);
    return NextResponse.redirect(
      `${appUrl}/connectors?error=storage_failed`
    );
  }

  return NextResponse.redirect(`${appUrl}/connectors?connected=google`);
}
