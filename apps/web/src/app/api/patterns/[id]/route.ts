import { NextResponse } from "next/server";
import { getPattern } from "@/lib/gbrain";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const pattern = await getPattern(id);

  if (!pattern) {
    return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
  }

  return NextResponse.json(pattern);
}

/**
 * DELETE /api/patterns/[id]
 *
 * Removes a single workflow pattern from brain_pages. Useful for cleaning
 * up noisy mined patterns (e.g. the miner occasionally surfaces a
 * degenerate `message_posted → message_posted` run that's uninteresting).
 *
 * The `id` route param is the URL-encoded slug (e.g.
 * `workflows%2Fbug-triage-fix-review`). We decode it back to the
 * canonical slug and delete the matching brain_pages row. Timeline and
 * link rows are left alone — they weren't linked to the workflow page
 * in the first place for mined patterns (the link is via
 * frontmatter.evidenceEventIds, which dies with the page).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const slug = decodeURIComponent(id);

  try {
    const supabase = createAdminClient();
    const result = await supabase
      .from("brain_pages")
      .delete()
      .eq("slug", slug);

    if (result.error) {
      return NextResponse.json(
        { error: "delete_failed", detail: result.error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, slug });
  } catch (err) {
    return NextResponse.json(
      {
        error: "delete_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
