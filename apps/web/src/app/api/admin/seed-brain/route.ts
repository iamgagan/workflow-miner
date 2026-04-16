import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDesktopMode } from "@/lib/supabase/local-shim";

/**
 * Build an ISO timestamp `daysBack` days before now, offset by `hour:minute`
 * within that day. Lets us seed events that cluster realistically — multiple
 * events within one work-day land in the same Sessionizer session, while
 * events on different days are isolated. Without distinct hours of day every
 * mined pattern would have avgDurationMs ≈ 0 because all timestamps would
 * collapse to the moment the seed ran.
 */
function timestamp(daysBack: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(hour, minute, 0, 0);
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
      support: 7,
      exampleSessions: [],
      steps: [
        { eventType: "bug_reported", position: 0, sourceSystem: "linear" },
        { eventType: "issue_triaged", position: 1, sourceSystem: "linear" },
        { eventType: "issue_updated", position: 2, sourceSystem: "linear" },
        { eventType: "code_reviewed", position: 3, sourceSystem: "slack" },
      ],
    },
  },
  {
    slug: "workflows/customer-escalation-pipeline",
    type: "workflow",
    title: "Customer Escalation Pipeline",
    frontmatter: {
      confidence: 0.91,
      breakdown: { frequency: 0.7, consistency: 0.85, completionRate: 0.9, automationPotential: 0.6 },
      support: 5,
      exampleSessions: [],
      steps: [
        { eventType: "email_received", position: 0, sourceSystem: "gmail" },
        { eventType: "escalation_raised", position: 1, sourceSystem: "linear" },
        { eventType: "message_posted", position: 2, sourceSystem: "slack" },
        { eventType: "followup_assigned", position: 3, sourceSystem: "linear" },
      ],
    },
  },
  {
    slug: "workflows/standup-plan-execute",
    type: "workflow",
    title: "Standup \u2192 Plan \u2192 Execute",
    frontmatter: {
      confidence: 0.82,
      breakdown: { frequency: 0.95, consistency: 0.75, completionRate: 0.8, automationPotential: 0.5 },
      support: 8,
      exampleSessions: [],
      steps: [
        { eventType: "meeting_scheduled", position: 0, sourceSystem: "calendar" },
        { eventType: "meeting_held", position: 1, sourceSystem: "calendar" },
        { eventType: "followup_assigned", position: 2, sourceSystem: "linear" },
        { eventType: "issue_created", position: 3, sourceSystem: "linear" },
      ],
    },
  },
  {
    slug: "workflows/pr-review-deploy-monitor",
    type: "workflow",
    title: "PR Review \u2192 Deploy \u2192 Monitor",
    frontmatter: {
      confidence: 0.78,
      breakdown: { frequency: 0.6, consistency: 0.7, completionRate: 0.75, automationPotential: 0.85 },
      support: 4,
      exampleSessions: [],
      // pr_opened (github) anchors the "PR" origin; code_reviewed/code_deployed/
      // message_posted all map to slack in EVENT_TOOL_MAP. Including pr_opened
      // keeps the workflow honest to its "GitHub + Slack" scope and ensures
      // toolPermissions covers both tools rather than collapsing to slack-only.
      steps: [
        { eventType: "pr_opened", position: 0, sourceSystem: "github" },
        { eventType: "code_reviewed", position: 1, sourceSystem: "slack" },
        { eventType: "code_deployed", position: 2, sourceSystem: "slack" },
        { eventType: "message_posted", position: 3, sourceSystem: "slack" },
      ],
    },
  },
  {
    slug: "workflows/meeting-notes-action-items",
    type: "workflow",
    title: "Meeting Notes \u2192 Action Items",
    frontmatter: {
      confidence: 0.73,
      breakdown: { frequency: 0.8, consistency: 0.65, completionRate: 0.7, automationPotential: 0.55 },
      support: 6,
      exampleSessions: [],
      steps: [
        { eventType: "meeting_held", position: 0, sourceSystem: "calendar" },
        { eventType: "decision_made", position: 1, sourceSystem: "linear" },
        { eventType: "followup_assigned", position: 2, sourceSystem: "linear" },
        { eventType: "issue_created", position: 3, sourceSystem: "linear" },
      ],
    },
  },
] as const;

/**
 * Scenario-driven timeline seed.
 *
 * Each scenario is a tight cluster of cross-tool events that all fall
 * within one work-day so the Sessionizer (4-hour gap) groups them into a
 * single session. Crucially, scenarios are scheduled on DIFFERENT days
 * from one another — if two scenarios share a day they collapse into one
 * mega-session and PrefixSpan suffers a combinatorial explosion.
 *
 * The summaries use keywords like "bug", "escalation", "meeting", "PR",
 * "deploy" so the keyword-aware `deriveEventType` resolver in
 * /api/patterns/mine maps each event to a meaningful `event_type`
 * (`bug_reported`, `meeting_scheduled`, `issue_created`, `code_pushed`).
 *
 * Replaying each scenario on multiple days gives the miner enough support
 * to surface it as a frequent subsequence, while keeping the alphabet
 * compact enough to avoid runaway pattern counts.
 */
interface SeedEvent {
  readonly toolSlug: string;
  readonly source: string;
  /** Hour of day the event happened (0-23). */
  readonly hour: number;
  readonly minute?: number;
  readonly summary: string;
}

interface SeedScenario {
  readonly name: string;
  readonly events: readonly SeedEvent[];
  /** Days-back at which to replay this scenario shape. Each replay produces
   * one fresh Sessionizer session. */
  readonly daysBack: readonly number[];
}

const SCENARIOS: readonly SeedScenario[] = [
  {
    name: "Bug triage flow",
    daysBack: [1, 5, 9, 13],
    events: [
      { toolSlug: "tools/gmail", source: "gmail", hour: 9, minute: 12, summary: "Bug report received from Sarah Chen" },
      { toolSlug: "tools/slack", source: "slack", hour: 9, minute: 28, summary: "Bug severity discussed in #triage" },
      { toolSlug: "tools/linear", source: "linear", hour: 9, minute: 47, summary: "Bug ticket LIN-487 moved to In Progress" },
      { toolSlug: "tools/calendar", source: "calendar", hour: 11, minute: 0, summary: "Bug triage meeting with Sarah Chen" },
    ],
  },
  {
    name: "Customer escalation pipeline",
    daysBack: [2, 6, 10],
    events: [
      { toolSlug: "tools/gmail", source: "gmail", hour: 8, minute: 45, summary: "URGENT customer escalation email from Marcus Johnson" },
      { toolSlug: "tools/slack", source: "slack", hour: 8, minute: 58, summary: "Escalation flagged in #support channel" },
      { toolSlug: "tools/linear", source: "linear", hour: 9, minute: 20, summary: "Customer issue LIN-501 escalated to P1" },
      { toolSlug: "tools/gmail", source: "gmail", hour: 11, minute: 15, summary: "Acknowledgment email reply sent to customer" },
    ],
  },
  {
    name: "Standup → plan → execute",
    daysBack: [3, 4, 7, 11],
    events: [
      { toolSlug: "tools/calendar", source: "calendar", hour: 9, minute: 30, summary: "Daily standup meeting held" },
      { toolSlug: "tools/slack", source: "slack", hour: 10, minute: 5, summary: "Standup thread posted in #daily" },
      { toolSlug: "tools/linear", source: "linear", hour: 10, minute: 22, summary: "Sprint task LIN-512 created from standup" },
    ],
  },
  {
    name: "PR review → deploy → monitor",
    daysBack: [3, 8, 12],
    events: [
      { toolSlug: "tools/slack", source: "slack", hour: 14, minute: 0, summary: "PR #142 review requested in #engineering" },
      { toolSlug: "tools/linear", source: "linear", hour: 14, minute: 35, summary: "PR review task LIN-519 assigned to Alex Rivera" },
      { toolSlug: "tools/slack", source: "slack", hour: 15, minute: 45, summary: "Deploy status shared in #releases" },
      { toolSlug: "tools/slack", source: "slack", hour: 16, minute: 30, summary: "Monitoring alert acknowledged in #ops" },
    ],
  },
  {
    name: "Meeting → notes → follow-ups",
    daysBack: [2, 7, 11],
    events: [
      { toolSlug: "tools/calendar", source: "calendar", hour: 13, minute: 0, summary: "Design review meeting for escalation flow" },
      { toolSlug: "tools/gmail", source: "gmail", hour: 14, minute: 5, summary: "Meeting follow-up notes shared via email" },
      { toolSlug: "tools/linear", source: "linear", hour: 14, minute: 30, summary: "Followup ticket LIN-530 created from meeting" },
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
  if (!isDesktopMode()) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json(
        { error: "Missing Supabase credentials" },
        { status: 500 },
      );
    }
  }

  const supabase = createAdminClient();

  try {
    // 0. Reset the brain so reseeding is idempotent. Without this, calling
    //    /api/admin/seed-brain twice doubles the timeline rows (the seeded
    //    page upserts dedupe by slug but timeline inserts don't have a
    //    unique key). We delete in dependency order: timeline → links →
    //    workflow pages. Tool/person pages are kept because they're
    //    referenced by stable slugs the rest of the app may depend on.
    await supabase.from("brain_timeline").delete().gte("id", 0);
    await supabase.from("brain_links").delete().gte("id", 0);
    await supabase
      .from("brain_pages")
      .delete()
      .eq("type", "workflow");

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

    // 2. Insert timeline entries by replaying each scenario across multiple
    //    days. Each scenario produces a tight cluster of cross-tool events
    //    that the Sessionizer groups into a single session, and replaying
    //    the same shape on multiple days gives PrefixSpan the support count
    //    it needs to surface the scenario as a mined pattern.
    const timelineEntries: Array<{
      page_id: number;
      date: string;
      source: string;
      summary: string;
    }> = [];

    for (const scenario of SCENARIOS) {
      for (const daysBack of scenario.daysBack) {
        for (const event of scenario.events) {
          const pageId = slugToId[event.toolSlug];
          if (!pageId) continue;
          timelineEntries.push({
            page_id: pageId,
            date: timestamp(daysBack, event.hour, event.minute ?? 0),
            source: event.source,
            summary: event.summary,
          });
        }
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
