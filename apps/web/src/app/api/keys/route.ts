import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey, hashApiKey } from "@/lib/mcp-auth";

interface CreateKeyBody {
  label: string;
}

// POST /api/keys — generate a new API key. Returns the raw key ONCE; the
// server only persists its SHA-256 hash, so this is the user's only chance
// to copy it.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: CreateKeyBody;
  try {
    body = (await request.json()) as CreateKeyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.label || typeof body.label !== "string" || body.label.length > 100) {
    return NextResponse.json({ error: "missing_or_invalid_label" }, { status: 400 });
  }

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);

  const { data, error } = await supabase
    .from("api_keys")
    .insert({ user_id: user.id, key_hash: keyHash, label: body.label })
    .select("id, label, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    label: data.label,
    createdAt: data.created_at,
    key: rawKey, // ONE-TIME REVEAL
  });
}

// GET /api/keys — list the caller's non-revoked keys.
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, label, created_at, last_used_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ keys: data ?? [] });
}
