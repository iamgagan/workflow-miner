import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { runMarkdownExportToDisk } from "@/inngest/functions";

// POST /api/export/run — manually trigger a Markdown export outside of the
// dream-cycle chain. Auth required.
//
// Cloud mode: dispatches the GitHub-push Inngest function.
// Desktop mode: writes pages directly to the local filesystem (no GitHub
// dependency) — default location is ~/Documents/Workflow Miner/export.
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.WORKFLOW_MINER_MODE === "desktop") {
    try {
      const result = await runMarkdownExportToDisk();
      return NextResponse.json({ ok: true, mode: "desktop", ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "export failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const { ids } = await inngest.send({
    name: "export/run.requested",
    data: { triggeredBy: user.id, source: "manual" },
  });

  return NextResponse.json({ ok: true, eventId: ids[0] });
}
