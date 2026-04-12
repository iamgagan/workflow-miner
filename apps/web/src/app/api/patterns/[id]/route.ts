import { NextResponse } from "next/server";
import { getPattern } from "@/lib/gbrain";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_STATUSES = ["confirmed", "rejected", "draft"] as const;
type UserStatus = (typeof VALID_STATUSES)[number];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const slug = decodeURIComponent(id);

  const [pattern, rawPage] = await Promise.all([
    getPattern(slug),
    (async () => {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("brain_pages")
        .select("frontmatter")
        .eq("slug", slug)
        .single();
      return data;
    })(),
  ]);

  if (!pattern) {
    return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
  }

  const frontmatter = (rawPage?.frontmatter ?? {}) as Record<string, unknown>;
  const userStatus = (frontmatter.userStatus as UserStatus | undefined) ?? "draft";

  return NextResponse.json({ ...pattern, userStatus });
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

/**
 * PATCH /api/patterns/[id]
 *
 * Updates the userStatus field in frontmatter for a pattern.
 * Body: { status: "confirmed" | "rejected" | "draft" }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const slug = decodeURIComponent(id);

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const status = body.status as string;
  if (!status || !VALID_STATUSES.includes(status as UserStatus)) {
    return NextResponse.json(
      { error: "invalid_status", detail: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();

    // Fetch the existing row to merge frontmatter
    const { data: page, error: fetchError } = await supabase
      .from("brain_pages")
      .select("slug, type, title, frontmatter")
      .eq("slug", slug)
      .single();

    if (fetchError || !page) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const existingFrontmatter = (page.frontmatter ?? {}) as Record<string, unknown>;
    const updatedFrontmatter = { ...existingFrontmatter, userStatus: status };

    // Use upsert instead of update because the local PGlite shim
    // doesn't implement .update(). Must include all NOT NULL columns
    // (slug, type, title) to satisfy the schema constraint.
    const { error: updateError } = await supabase
      .from("brain_pages")
      .upsert(
        {
          slug,
          type: page.type,
          title: page.title,
          frontmatter: updatedFrontmatter,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slug" },
      );

    if (updateError) {
      return NextResponse.json(
        { error: "update_failed", detail: updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, slug, userStatus: status });
  } catch (err) {
    return NextResponse.json(
      {
        error: "update_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
