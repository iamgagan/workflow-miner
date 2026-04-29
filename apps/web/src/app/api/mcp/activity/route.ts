import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateApiKey, parseBearerToken } from "@/lib/mcp-auth";

let _supa: ReturnType<typeof createClient> | null = null;
function supa() {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supa;
}

// GET /api/mcp/activity?source=slack&limit=50
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  let query = supa()
    .from("brain_timeline")
    .select("id, page_id, date, source, summary, detail")
    .order("date", { ascending: false })
    .limit(limit);

  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: data ?? [] });
}
