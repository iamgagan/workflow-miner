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

// GET /api/mcp/patterns?limit=20
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 100);

  const { data, error } = await supa()
    .from("brain_pages")
    .select("id, slug, title, compiled_truth, frontmatter, updated_at")
    .eq("type", "pattern")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    patterns: (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.slug,
      title: row.title,
      description: row.compiled_truth,
      frontmatter: row.frontmatter,
      lastUpdated: row.updated_at,
    })),
  });
}
