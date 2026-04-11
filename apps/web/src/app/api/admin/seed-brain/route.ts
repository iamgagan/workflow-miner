import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

const TOOL_PAGES = [
  { slug: "tools/gmail", type: "tool", title: "Gmail" },
  { slug: "tools/calendar", type: "tool", title: "Google Calendar" },
  { slug: "tools/slack", type: "tool", title: "Slack" },
  { slug: "tools/linear", type: "tool", title: "Linear" },
] as const;

const PERSON_PAGES = [
  { slug: "people/sarah-chen", type: "person", title: "Sarah Chen" },
  { slug: "people/marcus-johnson", type: "person", title: "Marcus Johnson" },
  { slug: "people/alex-rivera", type: "person", title: "Alex Rivera" },
] as const;

const WORKFLOW_PAGES = [
  {
    slug: "workflows/bug-triage-fix-review",
    type: "workflow",
    title: "Bug Triage \u2192 Fix \u2192 Review",
    frontmatter: {
      confidence: 0.87,
      breakdown: { frequency: 0.9, consistency: 0.8, completionRate: 0.85, automationPotential: 0.7 },
    },
  },
  {
    slug: "workflows/customer-escalation-pipeline",
    type: "workflow",
    title: "Customer Escalation Pipeline",
    frontmatter: {
      confidence: 0.91,
      breakdown: { frequency: 0.7, consistency: 0.85, completionRate: 0.9, automationPotential: 0.6 },
    },
  },
  {
    slug: "workflows/standup-plan-execute",
    type: "workflow",
    title: "Standup \u2192 Plan \u2192 Execute",
    frontmatter: {
      confidence: 0.82,
      breakdown: { frequency: 0.95, consistency: 0.75, completionRate: 0.8, automationPotential: 0.5 },
    },
  },
  {
    slug: "workflows/pr-review-deploy-monitor",
    type: "workflow",
    title: "PR Review \u2192 Deploy \u2192 Monitor",
    frontmatter: {
      confidence: 0.78,
      breakdown: { frequency: 0.6, consistency: 0.7, completionRate: 0.75, automationPotential: 0.85 },
    },
  },
  {
    slug: "workflows/meeting-notes-action-items",
    type: "workflow",
    title: "Meeting Notes \u2192 Action Items",
    frontmatter: {
      confidence: 0.73,
      breakdown: { frequency: 0.8, consistency: 0.65, completionRate: 0.7, automationPotential: 0.55 },
    },
  },
] as const;

const TIMELINE_TEMPLATES: ReadonlyArray<{
  readonly toolSlug: string;
  readonly source: string;
  readonly summaries: readonly string[];
}> = [
  {
    toolSlug: "tools/gmail",
    source: "gmail",
    summaries: [
      "Bug report received from Sarah Chen",
      "Customer escalation email from Marcus Johnson",
      "Weekly summary digest sent",
      "Meeting follow-up notes shared",
      "Feature request forwarded to product team",
      "Action items email from standup recap",
      "Deploy notification received",
      "PR review feedback from Alex Rivera",
    ],
  },
  {
    toolSlug: "tools/calendar",
    source: "calendar",
    summaries: [
      "Standup meeting held",
      "Sprint planning session",
      "Bug triage meeting with Sarah Chen",
      "1:1 with Marcus Johnson",
      "Design review for escalation flow",
      "Deploy window scheduled",
      "Retrospective meeting",
    ],
  },
  {
    toolSlug: "tools/slack",
    source: "slack",
    summaries: [
      "PR #142 review requested in #engineering",
      "Bug severity discussed in #triage",
      "Customer escalation flagged in #support",
      "Deploy status shared in #releases",
      "Standup thread posted in #daily",
      "Alex Rivera mentioned in #code-review",
      "Action items pinned in #team",
      "Monitoring alert acknowledged",
    ],
  },
  {
    toolSlug: "tools/linear",
    source: "linear",
    summaries: [
      "Bug ticket LIN-487 moved to In Progress",
      "Customer issue LIN-501 escalated to P1",
      "Sprint task LIN-512 completed",
      "PR review task LIN-519 assigned to Alex Rivera",
      "Deploy checklist LIN-523 created",
      "Meeting notes task LIN-530 marked done",
      "Monitoring ticket LIN-535 created from alert",
    ],
  },
];

const LINKS: ReadonlyArray<{
  readonly from_slug: string;
  readonly to_slug: string;
  readonly link_type: string;
  readonly context: string;
}> = [
  // People to tools
  { from_slug: "people/sarah-chen", to_slug: "tools/gmail", link_type: "appeared_in", context: "Bug reports and escalation emails" },
  { from_slug: "people/sarah-chen", to_slug: "tools/linear", link_type: "appeared_in", context: "Bug triage tickets" },
  { from_slug: "people/sarah-chen", to_slug: "tools/calendar", link_type: "appeared_in", context: "Triage meetings" },
  { from_slug: "people/marcus-johnson", to_slug: "tools/gmail", link_type: "appeared_in", context: "Customer escalation emails" },
  { from_slug: "people/marcus-johnson", to_slug: "tools/slack", link_type: "appeared_in", context: "Support channel discussions" },
  { from_slug: "people/marcus-johnson", to_slug: "tools/calendar", link_type: "appeared_in", context: "1:1 meetings" },
  { from_slug: "people/alex-rivera", to_slug: "tools/slack", link_type: "appeared_in", context: "Code review discussions" },
  { from_slug: "people/alex-rivera", to_slug: "tools/linear", link_type: "appeared_in", context: "PR review tasks" },
  // Workflows to tools
  { from_slug: "workflows/bug-triage-fix-review", to_slug: "tools/linear", link_type: "referenced_in", context: "Bug tickets flow through Linear" },
  { from_slug: "workflows/bug-triage-fix-review", to_slug: "tools/slack", link_type: "referenced_in", context: "Triage discussions in Slack" },
  { from_slug: "workflows/customer-escalation-pipeline", to_slug: "tools/gmail", link_type: "referenced_in", context: "Escalations arrive via email" },
  { from_slug: "workflows/customer-escalation-pipeline", to_slug: "tools/slack", link_type: "referenced_in", context: "Escalations flagged in #support" },
  { from_slug: "workflows/standup-plan-execute", to_slug: "tools/calendar", link_type: "referenced_in", context: "Daily standup meetings" },
  { from_slug: "workflows/standup-plan-execute", to_slug: "tools/slack", link_type: "referenced_in", context: "Standup threads in #daily" },
  { from_slug: "workflows/pr-review-deploy-monitor", to_slug: "tools/linear", link_type: "referenced_in", context: "Deploy checklists in Linear" },
];

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, anonKey);

  try {
    // 1. Insert pages (tools, people, workflows)
    const allPages = [
      ...TOOL_PAGES.map((p) => ({ ...p, frontmatter: {} })),
      ...PERSON_PAGES.map((p) => ({ ...p, frontmatter: {} })),
      ...WORKFLOW_PAGES.map((p) => ({ slug: p.slug, type: p.type, title: p.title, frontmatter: p.frontmatter })),
    ];

    const { data: pages, error: pagesError } = await supabase
      .from("brain_pages")
      .upsert(allPages, { onConflict: "slug" })
      .select("id, slug");

    if (pagesError) {
      return NextResponse.json({ error: "Failed to insert pages", detail: pagesError.message }, { status: 500 });
    }

    // Build slug-to-id map
    const slugToId: Record<string, number> = {};
    for (const p of pages ?? []) {
      slugToId[p.slug] = p.id;
    }

    // 2. Insert timeline entries (~30 entries across past 2 weeks)
    const timelineEntries: Array<{
      page_id: number;
      date: string;
      source: string;
      summary: string;
    }> = [];

    for (const tmpl of TIMELINE_TEMPLATES) {
      const pageId = slugToId[tmpl.toolSlug];
      if (!pageId) continue;
      for (let i = 0; i < tmpl.summaries.length; i++) {
        timelineEntries.push({
          page_id: pageId,
          date: daysAgo(Math.floor(Math.random() * 14)),
          source: tmpl.source,
          summary: tmpl.summaries[i],
        });
      }
    }

    const { error: timelineError } = await supabase
      .from("brain_timeline")
      .insert(timelineEntries);

    if (timelineError) {
      return NextResponse.json({ error: "Failed to insert timeline", detail: timelineError.message }, { status: 500 });
    }

    // 3. Insert links
    const { error: linksError } = await supabase
      .from("brain_links")
      .upsert([...LINKS], { onConflict: "from_slug,to_slug,link_type" });

    if (linksError) {
      return NextResponse.json({ error: "Failed to insert links", detail: linksError.message }, { status: 500 });
    }

    // 4. Verify via brain_stats
    const { data: stats, error: statsError } = await supabase
      .from("brain_stats")
      .select("*")
      .single();

    return NextResponse.json({
      ok: true,
      message: "Brain seeded successfully",
      stats,
      pagesInserted: pages?.length ?? 0,
      timelineInserted: timelineEntries.length,
      linksInserted: LINKS.length,
      statsError: statsError?.message ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Unexpected error", detail: String(err) },
      { status: 500 },
    );
  }
}
