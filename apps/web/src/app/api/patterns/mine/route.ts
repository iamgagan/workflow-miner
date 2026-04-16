import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  labelPatterns,
  type EvidenceMap,
  type EvidenceEvent,
} from "@/lib/pattern-labeler";
import {
  Sessionizer,
  PatternMiner,
  PatternScorer,
  type SessionEvent,
  type SessionSequence,
  type PatternCandidate,
  type PatternInstance,
  type ScoredPattern,
  type EventType,
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

    // Build a sessionId → events lookup so we can resolve evidence event IDs
    // AND reconstruct per-instance event sequences for the PatternScorer.
    // This must live here (before mining) because the quality-gate filter
    // below needs it to inspect source systems for each candidate pattern.
    const sessionEventsById = new Map<string, EventRow[]>();
    for (const session of sessions) {
      const events = eventRows.filter((e) =>
        session.eventIds.includes(e.event_id),
      );
      sessionEventsById.set(session.sessionId, events);
    }

    // 5a. Entity-anchored sessionization: build a second set of sessions
    //     grouped by shared entity anchors (Linear ticket IDs, Slack channels,
    //     person names). On busy days temporal grouping can create mega-sessions
    //     that make PrefixSpan explode combinatorially; entity sessions give the
    //     miner tighter, semantically-coherent windows to work with.
    const entitySessionSequences = buildEntitySessions(timelineEntries, eventRows);

    // Merge temporal + entity sessions before mining so PrefixSpan sees both
    // groupings. Duplicates are fine — support counting is additive.
    const allSessionSequences = [...sessionSequences, ...entitySessionSequences];

    // 5. Run PatternMiner with minSupport: 2 for small datasets and a
    //    conservative maxPatternLength so dense seed sessions don't
    //    blow up into tens of thousands of subsequences. Real workflow
    //    patterns are 2-6 steps; anything longer is signal-poor.
    const miner = new PatternMiner({ minSupport: 2, maxPatternLength: 6 });
    const minedPatterns = miner.mine(allSessionSequences);

    // --- Debug: collect diagnostics (non-production only) ---
    const isDebug = process.env.NODE_ENV !== "production";
    const debugDistinctEventTypes = isDebug
      ? Array.from(new Set(eventRows.map((e) => e.event_type))).sort()
      : undefined;
    const debugSampleTimeline = isDebug
      ? timelineEntries.slice(0, 10).map((e) => ({
          id: e.id,
          source: e.source,
          summary: e.summary,
          derivedType: deriveEventType(e.source, e.summary),
        }))
      : undefined;

    // Track which gate filters out each pattern for debug output.
    interface DebugFilteredPattern {
      readonly name: string;
      readonly support: number;
      readonly steps: readonly string[];
      readonly distinctTypeCount: number;
      readonly gate: string;
    }
    const debugFilteredOut: DebugFilteredPattern[] = [];

    // Quality gates: keep only patterns that meet ALL three criteria so
    // the persisted set contains meaningful cross-tool workflows rather
    // than degenerate same-tool or same-type runs.
    //   1. support >= 3  (stronger signal than the miner's minSupport: 2)
    //   2. >= 2 distinct event types in the step sequence
    //      (eliminates boring meeting → meeting → meeting runs)
    //   3. evidence events span >= 2 distinct source systems
    //      (ensures the pattern is genuinely cross-tool)
    // Determine how many distinct sources exist in the full dataset.
    // If only one source is connected, skip the cross-source requirement
    // so single-source users still get patterns. Once they connect
    // multiple tools, only cross-tool patterns are shown.
    const allSources = new Set(eventRows.map((e) => e.source_system));
    const requireCrossSource = allSources.size >= 2;

    const allPatterns = minedPatterns.filter((pattern) => {
      const stepTypes = pattern.steps.map((s) => s.eventType);
      const distinctTypes = new Set(stepTypes);

      // Gate 1: support threshold
      if (pattern.support < 3) {
        if (isDebug) {
          debugFilteredOut.push({
            name: pattern.name,
            support: pattern.support,
            steps: stepTypes,
            distinctTypeCount: distinctTypes.size,
            gate: "gate1_support<3",
          });
        }
        return false;
      }

      // Gate 2: at least 2 distinct event types in steps
      if (distinctTypes.size < 2) {
        if (isDebug) {
          debugFilteredOut.push({
            name: pattern.name,
            support: pattern.support,
            steps: stepTypes,
            distinctTypeCount: distinctTypes.size,
            gate: "gate2_singleEventType",
          });
        }
        return false;
      }

      // Gate 3: evidence events span >= 2 source systems.
      // Only enforced when the dataset contains events from 2+ sources.
      // Resolve evidence IDs from the first matching session so we can
      // inspect the underlying EventRow source_system fields directly.
      if (requireCrossSource) {
        const evidenceIds = collectEvidenceEventIds(
          stepTypes,
          pattern.exampleSessions,
          sessionEventsById,
        );
        const sources = new Set<string>();
        for (const id of evidenceIds) {
          const evt = eventRows.find((e) => e.event_id === id);
          if (evt?.source_system) sources.add(evt.source_system);
        }
        if (sources.size < 2) {
          if (isDebug) {
            debugFilteredOut.push({
              name: pattern.name,
              support: pattern.support,
              steps: stepTypes,
              distinctTypeCount: distinctTypes.size,
              gate: `gate3_singleSource(${Array.from(sources).join(",")})`,
            });
          }
          return false;
        }
      }

      return true;
    });

    // Cap how many patterns we persist. The miner already returns them
    // sorted by support desc then length desc; take the top 50 so the
    // dashboard / skills page stays focused on the most-supported flows.
    const patterns = allPatterns.slice(0, 50);

    // 5b. Score each mined pattern on the four dimensions the engine's
    //     PatternScorer exposes (frequency, consistency, completionRate,
    //     automationPotential). Without this we'd only have the raw
    //     support count as "confidence" and the dashboard's score radar
    //     would collapse into a single axis.
    const scorer = new PatternScorer();
    const candidates: PatternCandidate[] = patterns.map((pattern) => {
      const stepTypes = pattern.steps.map((s) => s.eventType);
      // Build one PatternInstance per supporting session by walking the
      // session's events in order and collecting the first match for
      // each step. An instance is "completed" if we found all steps.
      const instances: PatternInstance[] = pattern.exampleSessions.map(
        (sessionId) => {
          const events = sessionEventsById.get(sessionId) ?? [];
          const matched: string[] = [];
          let cursor = 0;
          for (const stepType of stepTypes) {
            for (let i = cursor; i < events.length; i++) {
              if (events[i].event_type === stepType) {
                matched.push(events[i].event_type);
                cursor = i + 1;
                break;
              }
            }
          }
          return {
            eventTypes: matched as readonly EventType[],
            completed: matched.length === stepTypes.length,
          };
        },
      );
      return {
        id: pattern.id,
        name: pattern.name,
        steps: stepTypes as readonly EventType[],
        instances,
      };
    });

    const scoredById = new Map<string, ScoredPattern>();
    for (const scored of scorer.scoreAll(candidates)) {
      scoredById.set(scored.patternId, scored);
    }

    // 5c. LLM-assisted pattern labeling: ask OpenRouter to generate
    //     human-readable names ("Bug Report to Triage Escalation") and
    //     one-sentence descriptions for each mined pattern. Fails
    //     gracefully if OPEN_ROUTER_API_KEY is not set — the pattern
    //     keeps its mechanically-generated name.
    const evidenceMap: EvidenceMap = new Map();
    for (const pattern of patterns) {
      const eids = collectEvidenceEventIds(
        pattern.steps.map((s) => s.eventType),
        pattern.exampleSessions,
        sessionEventsById,
      );
      const evidenceEvents: EvidenceEvent[] = eids
        .map((id) => eventRows.find((e) => e.event_id === id))
        .filter((e): e is EventRow => !!e)
        .map((e) => ({
          summary: e.content_text,
          source: e.source_system,
          timestamp: e.timestamp,
        }));
      evidenceMap.set(pattern.id, evidenceEvents);
    }
    const llmLabels = await labelPatterns(
      patterns.map((p) => ({
        id: p.id,
        name: p.name,
        steps: p.steps,
        compositeScore: scoredById.get(p.id)?.compositeScore ?? 0,
      })),
      evidenceMap,
    );

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

        // Derive the list of source systems (gmail/slack/linear/calendar)
        // that the evidence events came from. The pattern detail header
        // renders these as colored badges; without this they'd always
        // be empty for mined patterns because the workflow pages don't
        // have linked timeline rows via page_id.
        const sourceSet = new Set<string>();
        for (const id of evidenceEventIds) {
          const evt = eventRows.find((e) => e.event_id === id);
          if (evt?.source_system) sourceSet.add(evt.source_system);
        }
        const sources = Array.from(sourceSet);

        // Pull the scored dimensions (0-100 each) from the PatternScorer.
        // When scoring fails for some reason we fall back to the raw
        // support/totalSessions ratio so the UI still renders.
        const scored = scoredById.get(pattern.id);
        const breakdown = scored?.breakdown ?? {
          frequency: 0,
          consistency: 0,
          completionRate: 0,
          automationPotential: 0,
        };
        const compositeScore =
          scored?.compositeScore ?? Math.round(pattern.confidence * 100);

        // Use the LLM-generated name if available, otherwise keep the
        // mechanical event_type → event_type name from PrefixSpan.
        const label = llmLabels.get(pattern.id);
        const title = label?.name ?? pattern.name;
        const llmDescription = label?.description ?? "";

        const { error: upsertError } = await supabase
          .from("brain_pages")
          .upsert(
            {
              slug,
              type: "workflow",
              title,
              frontmatter: {
                // `confidence` stays 0..1 for backwards compat with the
                // existing listPatterns/getPattern helpers; UI code that
                // wants the composite 0..100 should read compositeScore.
                confidence: scored ? scored.compositeScore / 100 : pattern.confidence,
                compositeScore,
                breakdown,
                support: pattern.support,
                steps: pattern.steps,
                avgDurationMs: pattern.avgDurationMs,
                exampleSessions: pattern.exampleSessions,
                evidenceEventIds,
                sources,
                llmDescription,
                // Raw step-based name kept for debugging / provenance.
                rawPatternName: pattern.name,
                userStatus: "draft",
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

    // Build debug payload for non-production environments.
    const debugPayload = isDebug
      ? {
          rawPatternsFromMiner: minedPatterns.length,
          distinctEventTypes: debugDistinctEventTypes,
          sampleTimelineDerivations: debugSampleTimeline,
          firstFiveUnfilteredPatterns: minedPatterns.slice(0, 5).map((p) => ({
            name: p.name,
            support: p.support,
            steps: p.steps.map((s) => s.eventType),
          })),
          filteredOutPatterns: debugFilteredOut.slice(0, 20),
          allSourceSystems: Array.from(allSources),
          requireCrossSource,
          sessionCount: allSessionSequences.length,
          temporalSessionCount: sessionSequences.length,
          entitySessionCount: entitySessionSequences.length,
        }
      : undefined;

    return NextResponse.json({
      patterns,
      sessionsAnalyzed: allSessionSequences.length,
      eventsProcessed: timelineEntries.length,
      patternsFound: patterns.length,
      persistedErrors: failedUpserts.length > 0 ? failedUpserts : undefined,
      debug: debugPayload,
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
  const raw = (summary ?? "").trim();
  const text = raw.toLowerCase();

  // Step 0: Gmail thread structure signals. Real Gmail summaries are often
  // email subject lines that start with "Re:", "Fwd:", or contain thread
  // markers. These are strong structural signals that should produce
  // distinct event types regardless of the topical content.
  if (source?.toLowerCase() === "gmail" || /\bemail\b/.test(text)) {
    // Forwarded emails — information sharing / escalation.
    if (/^fwd:/i.test(raw) || /\bforwarded\b/.test(text))
      return "email_forwarded";

    // Reply threads — ongoing conversation.
    if (/^re:/i.test(raw) || /\breply\b/.test(text) || /\breplied\b/.test(text))
      return "email_replied";
  }

  // Step 1: keyword extraction. Specific verbs and concrete actions win
  // over generic nouns so a single scenario produces a varied step
  // sequence instead of collapsing onto one bucket. Examples:
  //
  //   "Bug report received from Sarah Chen"   -> bug_reported
  //   "Bug severity discussed in #triage"     -> issue_triaged
  //   "Bug ticket LIN-487 moved to In Progress" -> issue_updated
  //   "Bug triage meeting with Sarah Chen"    -> meeting_scheduled
  //
  // Without this priority order, all four would match the generic "bug"
  // keyword and the miner would surface degenerate `bug -> bug -> bug` runs.
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
    if (/\b(deploy(ed|ment)?|rollback|merged|released|shipped|release notes?)\b/.test(text))
      return "code_deployed";

    // PR review / approve / reject / code review.
    if (
      /\b(pr (review|merge)|pull request|review requested|approved|rejected|review feedback|code review|lgtm)\b/.test(
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

    // Meeting / calendar entries — expanded to catch email meeting invites
    // and common meeting-related subject patterns.
    if (
      /\b(meeting (held|scheduled|started|invite|notes|recap|minutes|cancelled|rescheduled)|1:?1|sync(ed)? up|call held|retrospective|standup|stand-up|kickoff|kick-off|huddle|check-?in meeting|office hours|all[- ]?hands|town[- ]?hall)\b/.test(
        text,
      )
    )
      return "meeting_scheduled";

    // Invitation / calendar-style emails.
    if (/\b(invit(e|ation|ed)|rsvp|calendar invite|agenda|you'?re invited)\b/.test(text))
      return "meeting_scheduled";

    // Triage / severity / assignment.
    if (/\b(triag(e|ed)|severity|assigned to|assign(ed|ment))\b/.test(text))
      return "issue_triaged";

    // Escalation: P0/P1 or "escalated to".
    if (/\b(escalat(ion|ed)|p0|p1|urgent|critical|blocker|blocked)\b/.test(text))
      return "escalation_raised";

    // Followup / action item / recap / summary / digest.
    if (/\b(followup|follow-up|follow up|action item|next step|recap|summary|digest|notes shared|takeaways)\b/.test(text))
      return "followup_assigned";

    // Decision recorded.
    if (/\b(decision|decide(d)?|outcome|chose|sign-?off|go\/no-go|approved)\b/.test(text))
      return "decision_made";

    // Notification / automated emails — common in Gmail.
    if (/\b(notification|automated|no-?reply|noreply|alert|monitoring|ci\/cd|build (failed|passed|succeeded)|pipeline)\b/.test(text))
      return "notification_received";

    // Request / ask — someone asking for something via email.
    if (/\b(request(ed|ing)?|please review|can you|could you|need your|feedback needed|input needed|awaiting)\b/.test(text))
      return "request_received";

    // Sharing / FYI — information broadcast.
    if (/\b(fyi|heads[- ]?up|sharing|shared|for your (info|review|reference)|attached|see attached|update on)\b/.test(text))
      return "info_shared";

    // Customer / client / external communication.
    if (/\b(customer|client|vendor|partner|external|prospect|lead|onboarding|renewal|contract|invoice|quote|proposal sent)\b/.test(text))
      return "customer_interaction";

    // Scheduling / availability.
    if (/\b(schedule|availab(le|ility)|time slot|book(ed)?|when can|free at|calendar)\b/.test(text))
      return "scheduling_request";

    // Generic chat surface.
    if (/\b(slack|channel|thread|dm)\b/.test(text)) return "message_posted";

    // Email — sent / received (broadened).
    if (/\b(email received|email sent|inbox|email from|email to|received from|sent to)\b/.test(text))
      return "email_received";

    // Generic bug / incident — last resort.
    if (/\b(bug|incident|outage|alert|error|crash|exception|failure)\b/.test(text))
      return "bug_reported";

    // Doc / spec / design / wiki.
    if (/\b(spec|doc(ument)?|design|proposal|wiki|confluence|readme|changelog)\b/.test(text))
      return "doc_shared";

    // Feature / product work.
    if (/\b(feature|enhancement|improvement|roadmap|requirement|user story|epic)\b/.test(text))
      return "feature_discussed";

    // Approval / sign-off.
    if (/\b(approv(e|ed|al)|sign[- ]?off|authorize|authoriz(e|ed))\b/.test(text))
      return "approval_given";

    // Onboarding / welcome.
    if (/\b(welcome|onboard(ing)?|getting started|new (hire|member|employee))\b/.test(text))
      return "onboarding_event";
  }

  // Step 2: source-aware fallback. For Gmail we try to differentiate
  // new threads from replies based on structural cues in the raw summary,
  // even when no keyword matched above.
  if (source) {
    switch (source.toLowerCase()) {
      case "gmail":
        // If we got here, no keyword matched. Distinguish new email vs.
        // generic email based on length / structure heuristics.
        // Short subjects (< 50 chars) with no "re:" are likely new threads.
        if (raw.length > 0 && raw.length < 50) return "email_sent";
        return "email_received";
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

/**
 * Extract entity anchors from a timeline entry's summary text.
 *
 * Three anchor classes are recognised:
 *   - Linear ticket IDs  e.g. "LIN-487"
 *   - Slack channel names e.g. "#triage", "#eng-platform"
 *   - Known person names  e.g. "Sarah Chen", "Marcus Johnson", "Alex Rivera"
 *
 * Returns a (possibly empty) array of normalised anchor strings.  Each anchor
 * is lowercased so matching is case-insensitive.
 */
function extractEntityAnchors(summary: string | null): string[] {
  if (!summary) return [];

  const anchors: string[] = [];

  // Linear ticket IDs: LIN- followed by one or more digits.
  const ticketMatches = summary.matchAll(/\bLIN-(\d+)\b/gi);
  for (const m of ticketMatches) {
    anchors.push(`lin-${m[1]}`);
  }

  // Slack channel names: # followed by alphanumeric / hyphen characters.
  const channelMatches = summary.matchAll(/#([a-z0-9][a-z0-9-]*)/gi);
  for (const m of channelMatches) {
    anchors.push(`#${m[1].toLowerCase()}`);
  }

  // Known person names.  The list is intentionally small and explicit so we
  // don't accidentally anchor on common words that happen to be capitalised.
  const knownPeople = [
    "Sarah Chen",
    "Marcus Johnson",
    "Alex Rivera",
  ];
  for (const name of knownPeople) {
    if (summary.includes(name)) {
      anchors.push(`person:${name.toLowerCase().replace(/\s+/g, "-")}`);
    }
  }

  return anchors;
}

/**
 * Build entity-scoped SessionSequence[] from timeline entries.
 *
 * For each entity anchor that appears in two or more timeline entries, we
 * create one SessionSequence containing all the events that reference that
 * anchor (sorted by timestamp so PrefixSpan sees them in order).  Events with
 * no anchors are ignored — they already appear in the temporal sessions.
 *
 * The entity session IDs are prefixed with "entity:" so they don't collide
 * with temporal session IDs.
 */
function buildEntitySessions(
  timelineEntries: Array<{
    id: string;
    date: string | null;
    source: string | null;
    summary: string | null;
    created_at: string;
  }>,
  eventRows: EventRow[],
): SessionSequence[] {
  // Map each anchor → list of event_ids that reference it.
  const anchorToEventIds = new Map<string, string[]>();

  for (const entry of timelineEntries) {
    const anchors = extractEntityAnchors(entry.summary);
    for (const anchor of anchors) {
      if (!anchorToEventIds.has(anchor)) {
        anchorToEventIds.set(anchor, []);
      }
      anchorToEventIds.get(anchor)!.push(entry.id);
    }
  }

  // Build a quick lookup from event_id → EventRow for O(1) access.
  const eventById = new Map<string, EventRow>();
  for (const row of eventRows) {
    eventById.set(row.event_id, row);
  }

  const entitySequences: SessionSequence[] = [];

  for (const [anchor, eventIds] of anchorToEventIds) {
    // Skip singleton anchors — they can't form a multi-step sequence and
    // would add noise to the support counts without any benefit.
    if (eventIds.length < 2) continue;

    // Resolve rows and sort by timestamp so PrefixSpan processes them in
    // chronological order regardless of how they appeared in the DB result.
    const rows = eventIds
      .map((id) => eventById.get(id))
      .filter((r): r is EventRow => r !== undefined)
      .sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

    const events: SessionEvent[] = rows.map((r) => ({
      eventType: r.event_type,
      timestamp: r.timestamp,
      sourceSystem: r.source_system,
      actorId: r.actor_id,
    }));

    entitySequences.push({
      // Slugify the anchor to produce a stable, readable session ID.
      sessionId: `entity:${anchor.replace(/[^a-z0-9:-]/g, "-")}`,
      events,
    });
  }

  return entitySequences;
}
