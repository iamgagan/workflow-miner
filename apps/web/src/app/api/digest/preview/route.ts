import { render } from "@react-email/components";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDesktopMode } from "@/lib/supabase/local-shim";
import { WeeklyDigest } from "@/emails/weekly-digest";
import type { WeeklyDigestProps, DigestPattern, NewPatternAlert, ExportReadyPattern } from "@/emails/weekly-digest";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function GET() {
  // Try to build from real data first
  let digestData: WeeklyDigestProps | null = null;
  try {
    if (isDesktopMode() || (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
      const supabase = createAdminClient();
      const now = new Date();
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data: timeline } = await supabase
        .from("brain_timeline")
        .select("*")
        .gte("date", weekAgo.toISOString())
        .order("date", { ascending: false });

      const { data: workflows } = await supabase
        .from("brain_pages")
        .select("*")
        .eq("type", "workflow")
        .order("frontmatter->confidence", { ascending: false });

      if (timeline && timeline.length > 0 && workflows && workflows.length > 0) {
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
        digestData = {
          weekStart: formatDate(weekAgo),
          weekEnd: formatDate(now),
          userName: "there",
          topPatterns: workflows.slice(0, 3).map((wf) => ({
            name: wf.title,
            occurrencesThisWeek: Math.round(((wf.frontmatter as Record<string, unknown>)?.confidence as number ?? 0.5) * timeline.length / workflows.length),
            occurrencesLastWeek: 0,
            totalHours: +(((wf.frontmatter as Record<string, unknown>)?.confidence as number ?? 0.5) * 3).toFixed(1),
            sources: [...new Set(timeline.map((e: Record<string, unknown>) => e.source as string))],
            sparkline: [0, 0, 0, 0, 0, 0, timeline.length],
          })),
          newPatterns: [],
          exportReady: [],
          dashboardUrl: `${baseUrl}/dashboard`,
          unsubscribeUrl: `${baseUrl}/settings/notifications?unsubscribe=weekly`,
        };
      }
    }
  } catch {
    // Fall through to error
  }

  if (!digestData) {
    return NextResponse.json(
      { error: "No digest data available. Sync events and mine patterns first." },
      { status: 404 },
    );
  }

  const html = await render(WeeklyDigest(digestData));
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
