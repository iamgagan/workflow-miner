import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

export async function POST(request: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 2. Parse query params
  const { searchParams } = new URL(request.url);
  const sourceParam = searchParams.get("source") ?? "all";
  const lookbackDays = parseInt(
    searchParams.get("lookbackDays") ?? "14",
    10,
  );

  const ALL_SOURCES = ["gmail", "calendar", "slack", "linear", "github", "notion", "jira", "outlook"];

  const sourcesToSync =
    sourceParam === "all"
      ? ALL_SOURCES
      : ALL_SOURCES.filter((s) => s === sourceParam);

  if (sourcesToSync.length === 0) {
    return NextResponse.json(
      {
        error: `Invalid source: ${sourceParam}. Must be one of: ${ALL_SOURCES.join(", ")}, all`,
      },
      { status: 400 },
    );
  }

  // 3. Trigger Inngest jobs for each source
  const events = sourcesToSync.map(source => ({
    name: "org/sync.requested" as const,
    data: {
      userId: user.id,
      organizationId: user.app_metadata.organization_id || user.id,
      source,
      lookbackDays,
    }
  }));

  await inngest.send(events);

  return NextResponse.json({ ok: true, message: `Dispatched ${events.length} sync jobs to Inngest` });
}
