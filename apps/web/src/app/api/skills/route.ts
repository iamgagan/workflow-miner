import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SkillData } from "@/lib/mock-skills";
import { workflowPageToSkill } from "@/lib/skill-mapper";

/**
 * GET /api/skills
 *
 * Lists all detected workflow patterns formatted as `SkillData`. The Skills
 * page renders these as cards. Patterns are stored in brain_pages with
 * type='workflow' and a frontmatter blob containing steps + confidence,
 * written by /api/patterns/mine.
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

export async function GET() {
  try {
    const supabase = createAdminClient();

    const result = await supabase
      .from("brain_pages")
      .select("id, slug, type, title, frontmatter, created_at, updated_at")
      .eq("type", "workflow")
      .order("updated_at", { ascending: false });

    if (result.error || !result.data) {
      return NextResponse.json({ skills: [] as SkillData[] });
    }

    const skills: SkillData[] = (result.data as BrainPageRow[]).map((row) =>
      workflowPageToSkill(row),
    );

    return NextResponse.json({ skills });
  } catch (err) {
    console.error("[/api/skills] failed", err);
    return NextResponse.json({ skills: [] as SkillData[] });
  }
}
