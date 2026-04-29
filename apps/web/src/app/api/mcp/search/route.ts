import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
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

let _openai: OpenAI | null = null;
function oai() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

interface SearchBody {
  query: string;
  match_threshold?: number;
  match_count?: number;
}

// POST /api/mcp/search — vector search over both pages and timeline.
// Auth: Authorization: Bearer wmk_*
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.query || typeof body.query !== "string") {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }

  const threshold = body.match_threshold ?? 0.7;
  const count = Math.min(body.match_count ?? 10, 50);

  const embedRes = await oai().embeddings.create({
    model: "text-embedding-3-small",
    input: body.query,
    encoding_format: "float",
  });
  const embedding = embedRes.data[0].embedding;

  // Cast to any: supabase-js infers RPC param types from generated DB types,
  // which we don't ship. The runtime behavior is correct.
  const client = supa() as unknown as {
    rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const [pagesRes, timelineRes] = await Promise.all([
    client.rpc("match_brain_pages", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: count,
    }),
    client.rpc("match_timeline_entries", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: count,
    }),
  ]);

  if (pagesRes.error || timelineRes.error) {
    return NextResponse.json(
      { error: pagesRes.error?.message ?? timelineRes.error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    pages: pagesRes.data ?? [],
    timeline: timelineRes.data ?? [],
  });
}
