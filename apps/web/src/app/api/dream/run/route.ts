import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { runDreamCycle } from "@/inngest/functions";

// POST /api/dream/run — manually trigger a Dream Cycle outside of cron.
// Auth required (any signed-in user can fire it; cost is bounded by
// DREAM_CYCLE_MAX_PAGES_PER_RUN).
//
// In cloud mode we dispatch via Inngest so retries / observability work.
// In desktop mode there's no Inngest webhook receiver, so we call the
// pure runner inline and return its result synchronously.
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.WORKFLOW_MINER_MODE === "desktop") {
    try {
      const result = await runDreamCycle();
      return NextResponse.json({ ok: true, mode: "desktop", ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "dream cycle failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const { ids } = await inngest.send({
    name: "dream/cycle.requested",
    data: { triggeredBy: user.id, source: "manual" },
  });

  return NextResponse.json({ ok: true, eventId: ids[0] });
}
