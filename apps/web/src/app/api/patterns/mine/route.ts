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

    // 5. Run PatternMiner with minSupport: 2 for small datasets
    const miner = new PatternMiner({ minSupport: 2 });
    const patterns = miner.mine(sessionSequences);

    // 6. Write/update brain_pages entries for each pattern
    const upsertResults = await Promise.all(
      patterns.map(async (pattern) => {
        const slug = `workflows/${slugify(pattern.name)}`;

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
 * Derive an event type string from the source and summary.
 * Uses source as the primary type, falling back to a keyword from summary.
 */
function deriveEventType(
  source: string | null,
  summary: string | null,
): string {
  if (source) return source;
  if (!summary) return "unknown";

  // Extract a simple type from the first few words of the summary
  const normalized = summary.toLowerCase().trim();
  if (normalized.includes("meeting") || normalized.includes("call"))
    return "meeting";
  if (normalized.includes("email") || normalized.includes("sent"))
    return "email";
  if (normalized.includes("commit") || normalized.includes("push"))
    return "code_commit";
  if (normalized.includes("review") || normalized.includes("pr"))
    return "code_review";
  if (normalized.includes("message") || normalized.includes("chat"))
    return "message";
  if (normalized.includes("task") || normalized.includes("issue"))
    return "task_update";
  return "activity";
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
