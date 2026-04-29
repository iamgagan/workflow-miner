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

interface Params {
  params: Promise<{ slug: string }>;
}

// GET /api/mcp/page/:slug — fetch a single brain page + its outgoing links.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { slug } = await params;

  const [pageRes, linksRes] = await Promise.all([
    supa()
      .from("brain_pages")
      .select("id, slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at")
      .eq("slug", slug)
      .maybeSingle(),
    supa()
      .from("brain_links")
      .select("from_slug, to_slug, link_type, context")
      .or(`from_slug.eq.${slug},to_slug.eq.${slug}`),
  ]);

  if (pageRes.error) {
    return NextResponse.json({ error: pageRes.error.message }, { status: 500 });
  }
  if (!pageRes.data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    page: pageRes.data,
    links: linksRes.data ?? [],
  });
}
