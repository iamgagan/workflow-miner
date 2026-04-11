import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { workflowPageToSkill } from "@/lib/skill-mapper";

/**
 * GET /api/skills/[id]/export
 *
 * Compiles a single workflow pattern (identified by its brain_pages slug)
 * into a Claude skill-pack YAML and returns it as a downloadable file.
 * The renderer can `<a href={url} download>` or open in a new tab to save.
 *
 * The pattern itself lives in brain_pages with type='workflow' — see
 * /api/patterns/mine for how it gets there.
 */
export const runtime = "nodejs";

interface BrainPageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  frontmatter: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // The id arrives URL-encoded (e.g. workflows%2Fbug-triage). Decode it
    // back to the canonical slug shape stored in brain_pages.
    const slug = decodeURIComponent(id);

    const supabase = createAdminClient();
    const result = await supabase
      .from("brain_pages")
      .select("id, slug, type, title, frontmatter, created_at, updated_at")
      .eq("slug", slug)
      .single();

    if (result.error || !result.data) {
      return NextResponse.json(
        { error: "pattern_not_found", detail: result.error?.message ?? null },
        { status: 404 },
      );
    }

    const skill = workflowPageToSkill(result.data as BrainPageRow);
    const filename = `${skill.id.replace(/[\/\\]/g, "-")}.skill.yaml`;

    return new NextResponse(skill.yaml, {
      status: 200,
      headers: {
        "Content-Type": "application/x-yaml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/skills/[id]/export] failed", err);
    return NextResponse.json(
      { error: "export_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
