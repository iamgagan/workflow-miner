import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  Sessionizer,
  PatternMiner,
  type SessionEvent,
  type SessionSequence,
} from "@workflow-miner/engine";

/** Minimal shape matching the engine's EventRow for Sessionizer.groupEvents() */
interface EventRow {
  readonly event_id: string;
  readonly source_system: string;
  readonly source_object_type: string;
  readonly source_object_id: string;
  readonly actor_id: string;
  readonly timestamp: string;
  readonly workspace_id: string | null;
  readonly conversation_id: string | null;
  readonly entity_refs: string;
  readonly event_type: string;
  readonly content_text: string | null;
  readonly metadata: string;
  readonly parent_event_id: string | null;
  readonly causal_links: string;
  readonly confidence: number;
  readonly pii_redaction_state: string;
  readonly created_at: string;
}

export const runtime = "nodejs";

/**
 * POST /api/patterns/mine
 *
 * Triggers pattern mining from brain_timeline data:
 * 1. Reads all timeline entries from Supabase
 * 2. Converts them to SessionEvent[] format
 * 3. Groups into sessions via Sessionizer (4-hour gap)
 * 4. Runs PatternMiner.mine()
 * 5. Writes/updates brain_pages entries of type 'workflow'
 * 6. Returns mined patterns as JSON
 */
export async function POST() {
  try {
    const supabase = createAdminClient();

    // 1. Read all timeline entries ordered by date
    const { data: timelineEntries, error: timelineError } = await supabase
      .from("brain_timeline")
      .select("id, page_id, date, source, summary, detail, created_at")
      .order("date", { ascending: true });

    if (timelineError) {
      return NextResponse.json(
        { error: "Failed to read timeline", detail: timelineError.message },
        { status: 500 },
      );
    }

    if (!timelineEntries || timelineEntries.length === 0) {
      return NextResponse.json(
        { patterns: [], message: "No timeline entries to mine" },
        { status: 200 },
      );
    }

    // 2. Convert timeline entries to EventRow-compatible format for Sessionizer
    const eventRows: EventRow[] = timelineEntries.map((entry) => ({
      event_id: entry.id,
      source_system: entry.source ?? "unknown",
      source_object_type: deriveEventType(entry.source, entry.summary),
      source_object_id: entry.id,
      actor_id: "default",
      timestamp: entry.date ?? entry.created_at,
      workspace_id: null,
      conversation_id: null,
      entity_refs: "[]",
      event_type: deriveEventType(entry.source, entry.summary),
      content_text: entry.summary ?? null,
      metadata: "{}",
      parent_event_id: null,
      causal_links: "[]",
      confidence: 1,
      pii_redaction_state: "clean",
      created_at: entry.created_at,
    }));

    // 3. Group events into sessions using Sessionizer (4-hour = 240 min gap)
    const sessionizer = new Sessionizer({ gapThresholdMinutes: 240 });
    const sessions = sessionizer.groupEvents(eventRows);

    // 4. Convert Sessionizer sessions to SessionSequence[] for PatternMiner
    const sessionSequences: SessionSequence[] = sessions.map((session) => {
      // Gather the original events for this session by matching event IDs
      const eventIdSet = new Set(session.eventIds);
      const sessionEvents: SessionEvent[] = eventRows
        .filter((e) => eventIdSet.has(e.event_id))
        .map((e) => ({
          eventType: e.event_type,
          timestamp: e.timestamp,
          sourceSystem: e.source_system,
          actorId: e.actor_id,
        }));

      return {
        sessionId: session.sessionId,
        events: sessionEvents,
      };
    });

    // 5. Run PatternMiner with minSupport: 2 for small datasets and a
    //    conservative maxPatternLength so dense seed sessions don't
    //    blow up into tens of thousands of subsequences. Real workflow
    //    patterns are 2-6 steps; anything longer is signal-poor.
    const miner = new PatternMiner({ minSupport: 2, maxPatternLength: 6 });
    const allPatterns = miner.mine(sessionSequences);

    // Cap how many patterns we persist. The miner already returns them
    // sorted by support desc then length desc; take the top 50 so the
    // dashboard / skills page stays focused on the most-supported flows.
    const patterns = allPatterns.slice(0, 50);

    // Build a sessionId → events lookup so we can resolve evidence event IDs
    // when persisting each pattern below.
    const sessionEventsById = new Map<string, EventRow[]>();
    for (const session of sessions) {
      const events = eventRows.filter((e) =>
        session.eventIds.includes(e.event_id),
      );
      sessionEventsById.set(session.sessionId, events);
    }

    // 6. Write/update brain_pages entries for each pattern. We also resolve
    //    a small set of "evidence event IDs" for each pattern: the actual
    //    timeline rows whose event_type sequence matched the pattern in the
    //    first contributing session. This is what the pattern detail page
    //    reads via /api/patterns/[id]/evidence — without it the evidence
    //    panel was always empty because timeline entries are linked to
    //    source tool pages, not workflow pages.
    const upsertResults = await Promise.all(
      patterns.map(async (pattern) => {
        const slug = `workflows/${slugify(pattern.name)}`;

        const evidenceEventIds = collectEvidenceEventIds(
          pattern.steps.map((s) => s.eventType),
          pattern.exampleSessions,
          sessionEventsById,
        );

        const { error: upsertError } = await supabase
          .from("brain_pages")
          .upsert(
            {
              slug,
              type: "workflow",
              title: pattern.name,
              frontmatter: {
                confidence: pattern.confidence,
                support: pattern.support,
                steps: pattern.steps,
                avgDurationMs: pattern.avgDurationMs,
                exampleSessions: pattern.exampleSessions,
                evidenceEventIds,
                minedAt: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "slug" },
          );

        return { slug, error: upsertError?.message ?? null };
      }),
    );

    const failedUpserts = upsertResults.filter((r) => r.error !== null);

    return NextResponse.json({
      patterns,
      sessionsAnalyzed: sessionSequences.length,
      eventsProcessed: timelineEntries.length,
      patternsFound: patterns.length,
      persistedErrors: failedUpserts.length > 0 ? failedUpserts : undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during mining";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Derive a semantic event type from a brain_timeline entry's source +
 * summary. The mining alphabet is what determines pattern quality: if the
 * alphabet is just `gmail`/`slack`/`linear`/`calendar` (the source names)
 * then PrefixSpan can only find boring patterns like `gmail → gmail`.
 * Mapping to verbs like `email_received` / `meeting_scheduled` /
 * `issue_created` lets the miner discover meaningful cross-tool sequences
 * such as `email_received → meeting_scheduled → issue_created`.
 *
 * Resolution order:
 *   1. Check the summary text for known intent keywords (verb + object).
 *      This is the dominant signal since real connector summaries are
 *      "Bug reported by Alice", "Meeting scheduled with Marcus", etc.
 *   2. Fall back to the source-aware default (e.g. `gmail` → `email_event`,
 *      `linear` → `issue_event`) so a summary-less entry still produces a
 *      meaningful type rather than collapsing onto a single bucket.
 *   3. Last-resort `activity` for anything else.
 */
function deriveEventType(
  source: string | null,
  summary: string | null,
): string {
  const text = (summary ?? "").toLowerCase().trim();

  // Step 1: keyword extraction. Specific verbs and concrete actions win
  // over generic nouns so a single scenario produces a varied step
  // sequence instead of collapsing onto one bucket. Examples:
  //
  //   "Bug report received from Sarah Chen"   → bug_reported
  //   "Bug severity discussed in #triage"     → issue_triaged
  //   "Bug ticket LIN-487 moved to In Progress" → issue_created
  //   "Bug triage meeting with Sarah Chen"    → meeting_scheduled
  //
  // Without this priority order, all four would match the generic "bug"
  // keyword and the miner would surface degenerate `bug → bug → bug` runs.
  if (text) {
    // Step 1A: action verbs that always win, regardless of topical noise.
    // These are "this event was a CREATE/POST/SEND/etc." signals.

    // Created / opened — issue lifecycle start.
    if (
      /\b(created from|created with|created\b|opened|filed)\b/.test(text) &&
      /\b(ticket|issue|task|story|alert)\b/.test(text)
    )
      return "issue_created";

    // Moved / updated — issue lifecycle middle.
    if (/\b(moved to|in progress|updated|reassigned)\b/.test(text))
      return "issue_updated";

    // Reply / acknowledgment / forward — email actions.
    if (
      /\b(reply sent|reply received|acknowledgment|acknowledg(e|ed) email|forwarded|follow-?up email)\b/.test(
        text,
      )
    )
      return "email_replied";

    // Deploy / release / rollback.
    if (/\b(deploy(ed)?|rollback|merged|released|shipped)\b/.test(text))
      return "code_deployed";

    // PR review / approve / reject.
    if (
      /\b(pr (review|merge)|pull request|review requested|approved|rejected|review feedback)\b/.test(
        text,
      )
    )
      return "code_reviewed";

    // Posted / flagged / mentioned in a channel — chat messages. We check
    // this BEFORE the meeting topical check so a "thread posted about a
    // standup" gets classified as a message, not a meeting.
    if (/\b(posted in|flagged in|mentioned in|thread (posted|started)|dm sent)\b/.test(text))
      return "message_posted";

    // Step 1B: topic / setting nouns. Apply only when no action verb above
    // matched, so a meeting that schedules a follow-up classifies as a
    // meeting and a chat message ABOUT a meeting classifies as a message.

    // Meeting / calendar entries. Avoid the bare word "standup" so a
    // downstream event mentioning a standup doesn't get reclassified as one.
    if (/\b(meeting (held|scheduled|started)|1:?1|sync(ed)? up|call held|retrospective)\b/.test(text))
      return "meeting_scheduled";

    // Triage / severity / assignment.
    if (/\b(triag(e|ed)|severity|assigned to)\b/.test(text)) return "issue_triaged";

    // Escalation: P0/P1 or "escalated to".
    if (/\b(escalat(ion|ed)|p0|p1|urgent)\b/.test(text)) return "escalation_raised";

    // Followup / action item.
    if (/\b(followup|follow-up|action item|next step)\b/.test(text))
      return "followup_assigned";

    // Decision recorded.
    if (/\b(decision|decide(d)?|outcome|chose)\b/.test(text)) return "decision_made";

    // Generic chat surface.
    if (/\b(slack|channel|thread|dm)\b/.test(text)) return "message_posted";

    // Email — sent / received.
    if (/\b(email received|email sent|inbox|email from|email to)\b/.test(text))
      return "email_received";

    // Generic bug / incident — last resort.
    if (/\b(bug|incident|outage|alert)\b/.test(text)) return "bug_reported";

    // Doc / spec / design.
    if (/\b(spec|doc|design|proposal)\b/.test(text)) return "doc_shared";
  }

  // Step 2: source-aware fallback. We avoid returning the bare source name
  // because that gives the miner a degenerate single-letter alphabet.
  if (source) {
    switch (source.toLowerCase()) {
      case "gmail":
        return "email_event";
      case "calendar":
        return "calendar_event";
      case "slack":
        return "message_event";
      case "linear":
        return "issue_event";
      default:
        return `${source.toLowerCase()}_event`;
    }
  }

  return "activity";
}

/**
 * Walk the supporting sessions in order and collect, from the FIRST session
 * that fully contains the pattern's step sequence, the actual event IDs
 * that matched each step. Up to `maxSessions` sessions are scanned to find
 * a match (in case the first one was already pruned). Returns at most
 * `pattern.steps.length` event IDs in step order.
 *
 * This is what makes the evidence panel on the pattern detail page actually
 * show real events instead of an empty list.
 */
function collectEvidenceEventIds(
  stepEventTypes: readonly string[],
  supportingSessions: readonly string[],
  sessionEventsById: ReadonlyMap<string, EventRow[]>,
  maxSessions = 5,
): string[] {
  for (const sessionId of supportingSessions.slice(0, maxSessions)) {
    const events = sessionEventsById.get(sessionId);
    if (!events || events.length === 0) continue;

    // Find the first occurrence of each step type, advancing the cursor
    // so steps must appear in order. Mirrors the engine's matching logic.
    const matched: string[] = [];
    let cursor = 0;
    for (const stepType of stepEventTypes) {
      let found = false;
      for (let i = cursor; i < events.length; i++) {
        if (events[i].event_type === stepType) {
          matched.push(events[i].event_id);
          cursor = i + 1;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (matched.length === stepEventTypes.length) {
      return matched;
    }
  }
  return [];
}

/**
 * Convert a pattern name to a URL-safe slug.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*→\s*/g, "-to-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
