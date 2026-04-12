import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/admin/reset-brain
 *
 * Wipes all locally-stored brain data:
 *   - brain_timeline (all rows)
 *   - brain_links (all rows)
 *   - brain_pages where type != 'tool' and type != 'person'
 *   - activity_log (all rows)
 *
 * Uses the admin client to bypass RLS.
 */
export async function POST() {
  try {
    const supabase = createAdminClient();

    // Run deletes sequentially to avoid overwhelming the local PGlite shim.
    // Each delete targets all rows via a truthy filter (neq id '' doesn't
    // work for UUID columns; we use gte created_at epoch instead).
    const epoch = "1970-01-01T00:00:00.000Z";

    const timelineResult = await supabase
      .from("brain_timeline")
      .delete()
      .gte("created_at", epoch);

    if (timelineResult.error) {
      return NextResponse.json(
        { error: "brain_timeline_failed", detail: timelineResult.error.message },
        { status: 500 },
      );
    }

    const linksResult = await supabase
      .from("brain_links")
      .delete()
      .gte("created_at", epoch);

    if (linksResult.error) {
      return NextResponse.json(
        { error: "brain_links_failed", detail: linksResult.error.message },
        { status: 500 },
      );
    }

    // brain_pages: delete workflow + concept rows. We can't use .not()
    // because the local PGlite shim doesn't implement it; instead we
    // target the specific types that mining/seeding create. Tool and
    // person rows are preserved so the source pages stay intact.
    const pagesWorkflow = await supabase
      .from("brain_pages")
      .delete()
      .eq("type", "workflow");
    const pagesConcept = await supabase
      .from("brain_pages")
      .delete()
      .eq("type", "concept");
    const pagesResult = {
      error: pagesWorkflow.error ?? pagesConcept.error,
    };

    if (pagesResult.error) {
      return NextResponse.json(
        { error: "brain_pages_failed", detail: pagesResult.error.message },
        { status: 500 },
      );
    }

    const activityResult = await supabase
      .from("activity_log")
      .delete()
      .gte("created_at", epoch);

    // activity_log failure is non-fatal — table may not exist in all
    // deployments (it was added after the initial schema).
    const activityError = activityResult.error
      ? activityResult.error.message
      : null;

    return NextResponse.json({
      ok: true,
      warnings: activityError ? [`activity_log: ${activityError}`] : [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "reset_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
