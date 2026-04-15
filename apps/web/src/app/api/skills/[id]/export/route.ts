import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exportWorkflow,
  isValidFormat,
  FORMAT_META,
  type ExportFormat,
  type ExportableWorkflow,
} from "@/lib/skill-exporters";

/**
 * GET /api/skills/[id]/export?format={claude|n8n|zapier|json}
 *
 * Compiles a mined workflow pattern (by brain_pages slug) into the
 * requested deployment target. Default is `claude` for backwards
 * compatibility with earlier clients that didn't specify a format.
 *
 *   claude  → Claude skill pack YAML
 *   n8n     → n8n workflow JSON (importable)
 *   zapier  → Zapier Zap template JSON
 *   json    → Generic runtime-agnostic JSON spec
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

interface PatternStep {
  eventType: string;
  position: number;
  sourceSystem?: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const slug = decodeURIComponent(id);

    const requestedFormat = new URL(request.url).searchParams.get("format") ?? "claude";
    const format: ExportFormat = isValidFormat(requestedFormat) ? requestedFormat : "claude";

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

    const row = result.data as BrainPageRow;
    const frontmatter = (row.frontmatter ?? {}) as Record<string, unknown>;
    const rawSteps = Array.isArray(frontmatter.steps) ? (frontmatter.steps as PatternStep[]) : [];

    const workflow: ExportableWorkflow = {
      slug: row.slug,
      title: row.title,
      steps: rawSteps,
      confidence: typeof frontmatter.confidence === "number" ? frontmatter.confidence : 0.5,
      support: typeof frontmatter.support === "number" ? frontmatter.support : 0,
    };

    const body = exportWorkflow(workflow, format);
    const { ext, mime } = FORMAT_META[format];
    const baseName = row.slug.replace(/[\/\\]/g, "-");
    const filename = `${baseName}.${ext}`;

    // Record the export so the dashboard stat reflects reality
    try {
      await supabase.from("activity_log").insert({
        user_id: "local",
        source: "skills",
        type: "export",
        description: `Exported workflow (${format}): ${row.title}`,
      });
    } catch {
      /* activity_log may not exist on legacy deployments */
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": mime,
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
