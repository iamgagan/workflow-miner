import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

// POST /api/dream/run — manually trigger a Dream Cycle outside of cron.
// Auth required (any signed-in user can fire it; cost is bounded by
// DREAM_CYCLE_MAX_PAGES_PER_RUN).
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { ids } = await inngest.send({
    name: "dream/cycle.requested",
    data: { triggeredBy: user.id, source: "manual" },
  });

  return NextResponse.json({ ok: true, eventId: ids[0] });
}
