import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

// POST /api/export/run — manually trigger a Markdown export outside of the
// dream-cycle chain. Auth required.
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { ids } = await inngest.send({
    name: "export/run.requested",
    data: { triggeredBy: user.id, source: "manual" },
  });

  return NextResponse.json({ ok: true, eventId: ids[0] });
}
