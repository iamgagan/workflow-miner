import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// Dev-only seed endpoint. Disabled in production to keep anonymous callers
// from spamming the brain with fake orgs.
export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_IN_PRODUCTION !== "true") {
    return NextResponse.json({ error: "seed endpoint disabled in production" }, { status: 403 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const organizationId = "org_test_" + randomUUID();

  // Fake embeddings since we don't need real ones for a simple insert test
  const fakeEmbedding = new Array(1536).fill(0.1);

  const { error: pageError } = await supabase.from("brain_pages").insert([
    {
      organization_id: organizationId,
      slug: "doc-1",
      type: "concept",
      title: "Q3 Engineering Roadmap",
      compiled_truth: "The team agreed to migrate the database to Supabase and use pgvector for AI.",
      embedding: fakeEmbedding,
    }
  ]);

  const { error: timelineError } = await supabase.from("brain_timeline").insert([
    {
      organization_id: organizationId,
      date: new Date().toISOString(),
      source: "slack",
      summary: "Database Migration discussion",
      detail: "Garry said we should use Agentic RAG for the new Company Brain feature.",
      embedding: fakeEmbedding,
      page_id: null,
    }
  ]);

  if (pageError || timelineError) {
    return NextResponse.json({ error: { pageError, timelineError } }, { status: 500 });
  }

  return NextResponse.json({ ok: true, organizationId });
}
