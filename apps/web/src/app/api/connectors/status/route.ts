import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: tokens, error: queryError } = await supabase
    .from("connector_tokens")
    .select("provider, scopes, expires_at, updated_at, metadata")
    .eq("user_id", user.id);

  if (queryError) {
    console.error("Failed to fetch connector status:", queryError);
    return NextResponse.json(
      { error: "Failed to fetch connector status" },
      { status: 500 }
    );
  }

  // Build a lookup by provider
  const connectors: Record<
    string,
    {
      connected: boolean;
      lastSync: string | null;
      expiresAt: string | null;
      scopes: string;
    }
  > = {};

  for (const token of tokens ?? []) {
    connectors[token.provider] = {
      connected: true,
      lastSync: token.updated_at,
      expiresAt: token.expires_at,
      scopes: token.scopes,
    };
  }

  return NextResponse.json({ connectors });
}
