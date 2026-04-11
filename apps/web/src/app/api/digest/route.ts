import { NextResponse } from "next/server";
import { render } from "@react-email/components";
import { createClient } from "@supabase/supabase-js";
import { WeeklyDigest } from "@/emails/weekly-digest";
import { MOCK_DIGEST_DATA } from "@/emails/mock-digest-data";
import type { WeeklyDigestProps, DigestPattern, NewPatternAlert, ExportReadyPattern } from "@/emails/weekly-digest";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function buildDigestFromBrain(): Promise<WeeklyDigestProps | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) return null;

  const supabase = createClient(supabaseUrl, anonKey);

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // Fetch timeline events from the past week
  const { data: recentTimeline, error: tlError } = await supabase
    .from("brain_timeline")
    .select("*")
    .gte("date", weekAgo.toISOString())
    .order("date", { ascending: false });

  if (tlError || !recentTimeline || recentTimeline.length === 0) return null;

  // Fetch timeline events from the previous week (for comparison)
  const { data: prevTimeline } = await supabase
    .from("brain_timeline")
    .select("*")
    .gte("date", twoWeeksAgo.toISOString())
    .lt("date", weekAgo.toISOString());

  // Fetch workflow pages (patterns)
  const { data: workflows, error: wfError } = await supabase
    .from("brain_pages")
    .select("*")
    .eq("type", "workflow")
    .order("frontmatter->confidence", { ascending: false });

  if (wfError || !workflows || workflows.length === 0) return null;

  // Build source counts for this week and last week by source
  const thisWeekBySrc: Record<string, number> = {};
  const prevWeekBySrc: Record<string, number> = {};

  for (const entry of recentTimeline) {
    thisWeekBySrc[entry.source] = (thisWeekBySrc[entry.source] ?? 0) + 1;
  }
  for (const entry of prevTimeline ?? []) {
    prevWeekBySrc[entry.source] = (prevWeekBySrc[entry.source] ?? 0) + 1;
  }

  // Build daily sparkline for the past 7 days
  function buildSparkline(entries: typeof recentTimeline): readonly number[] {
    const days = [0, 0, 0, 0, 0, 0, 0];
    if (!entries) return days;
    for (const e of entries) {
      const dayDiff = Math.floor((now.getTime() - new Date(e.date).getTime()) / (1000 * 60 * 60 * 24));
      if (dayDiff >= 0 && dayDiff < 7) {
        days[6 - dayDiff] += 1;
      }
    }
    return days;
  }

  // Map workflows to DigestPattern using timeline data
  const topPatterns: DigestPattern[] = workflows.slice(0, 3).map((wf) => {
    const fm = (wf.frontmatter ?? {}) as Record<string, unknown>;
    const confidence = (fm.confidence as number) ?? 0;
    const sources = Object.keys(thisWeekBySrc);

    return {
      name: wf.title,
      occurrencesThisWeek: Math.round(confidence * recentTimeline.length / workflows.length),
      occurrencesLastWeek: Math.round(confidence * (prevTimeline?.length ?? 0) / workflows.length),
      totalHours: +(confidence * 3).toFixed(1),
      sources,
      sparkline: buildSparkline(recentTimeline),
    };
  });

  // Newer patterns (lower confidence) as "new pattern alerts"
  const newPatterns: NewPatternAlert[] = workflows.slice(3).map((wf) => {
    const fm = (wf.frontmatter ?? {}) as Record<string, unknown>;
    const breakdown = (fm.breakdown ?? {}) as Record<string, unknown>;
    return {
      name: wf.title,
      detectedOn: formatDate(weekAgo),
      sources: Object.keys(thisWeekBySrc).slice(0, 2),
    };
  });

  // High-confidence workflows as export-ready
  const exportReady: ExportReadyPattern[] = workflows
    .filter((wf) => {
      const fm = (wf.frontmatter ?? {}) as Record<string, unknown>;
      return ((fm.confidence as number) ?? 0) >= 0.8;
    })
    .map((wf) => {
      const fm = (wf.frontmatter ?? {}) as Record<string, unknown>;
      return {
        name: wf.title,
        confidence: Math.round(((fm.confidence as number) ?? 0) * 100),
        exportUrl: `https://app.workflowminer.dev/patterns/${wf.slug.split("/").pop()}/export`,
      };
    });

  return {
    weekStart: formatDate(weekAgo),
    weekEnd: formatDate(now),
    userName: "there",
    topPatterns,
    newPatterns,
    exportReady,
    dashboardUrl: "https://app.workflowminer.dev/dashboard",
    unsubscribeUrl: "https://app.workflowminer.dev/settings/notifications?unsubscribe=weekly",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isCron = searchParams.get("cron") === "true";

  // Build digest data from brain, fall back to mock
  const digestData = (await buildDigestFromBrain()) ?? MOCK_DIGEST_DATA;
  const html = await render(WeeklyDigest(digestData));

  if (isCron) {
    // Cron invocation — in production, send email via Resend/nodemailer here
    return NextResponse.json({
      ok: true,
      cron: true,
      subject: `Your Week in Patterns \u2014 ${digestData.weekStart} to ${digestData.weekEnd}`,
      htmlLength: html.length,
      source: digestData === MOCK_DIGEST_DATA ? "mock" : "brain",
    });
  }

  // Non-cron GET — return rendered HTML for preview
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { to } = body as { to?: string };

  if (!to) {
    return NextResponse.json(
      { error: "Missing required field: to" },
      { status: 400 },
    );
  }

  // Build digest data from brain, fall back to mock
  const digestData = (await buildDigestFromBrain()) ?? MOCK_DIGEST_DATA;
  const html = await render(WeeklyDigest(digestData));

  // In production, send via Resend or nodemailer.
  // For now, return the rendered HTML as confirmation.
  return NextResponse.json({
    ok: true,
    to,
    subject: `Your Week in Patterns \u2014 ${digestData.weekStart} to ${digestData.weekEnd}`,
    htmlLength: html.length,
    source: digestData === MOCK_DIGEST_DATA ? "mock" : "brain",
  });
}
