import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateApiKey, parseBearerToken } from "@/lib/mcp-auth";
import { withCors, corsPreflight } from "@/lib/cors";
import { inngest } from "@/inngest/client";

export const OPTIONS = corsPreflight;

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

interface TriggerBody {
  workflowId: string;
  parameters?: Record<string, string>;
}

// POST /api/mcp/trigger — same dispatch path as the brain agent's
// triggerWorkflow tool. Validates the pattern exists, then sends an
// Inngest event.
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return withCors(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

  let body: TriggerBody;
  try {
    body = (await request.json()) as TriggerBody;
  } catch {
    return withCors(NextResponse.json({ error: "invalid_json" }, { status: 400 }));
  }

  if (!body.workflowId) {
    return withCors(NextResponse.json({ error: "missing_workflow_id" }, { status: 400 }));
  }

  const idAsNumber = Number(body.workflowId);
  const orFilter = Number.isNaN(idAsNumber)
    ? `slug.eq.${body.workflowId}`
    : `slug.eq.${body.workflowId},id.eq.${idAsNumber}`;

  const { data: pattern, error } = await supa()
    .from("brain_pages")
    .select("id, slug, title")
    .or(orFilter)
    .eq("type", "pattern")
    .maybeSingle();

  if (error || !pattern) {
    return withCors(NextResponse.json({ error: "pattern_not_found" }, { status: 404 }));
  }

  const p = pattern as { id: number; slug: string; title: string };

  const { ids } = await inngest.send({
    name: "pattern/execute.requested",
    data: {
      userId: auth.userId,
      patternId: p.id,
      patternSlug: p.slug,
      parameters: body.parameters ?? {},
    },
  });

  return withCors(
    NextResponse.json({
      ok: true,
      eventId: ids[0],
      patternTitle: p.title,
    })
  );
}
