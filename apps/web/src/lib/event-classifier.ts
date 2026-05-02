/**
 * LLM-assisted event classification.
 *
 * Replaces the regex stack in `deriveEventType` (in /api/patterns/mine) with
 * a batched LLM call that maps each brain_timeline summary onto a fixed
 * taxonomy of workflow event types. Also extracts a coarse `actor` and
 * `objectRef` (ticket ID, channel name, person, thread id) so the entity-
 * anchored sessionizer in mine/route.ts can work on real data instead of
 * relying on a hardcoded person list.
 *
 * Behaviour:
 *   - Batches up to BATCH_SIZE summaries per LLM call (default 25).
 *   - Concurrency capped at CONCURRENCY (default 3) to avoid rate limits.
 *   - Each summary is keyed by its event_id; identical summary text is
 *     deduped within a request via an in-memory cache.
 *   - On any failure (no API key, network, parse, type out of taxonomy)
 *     the caller's regex fallback runs — classifyEvents NEVER throws.
 *   - Output is a Map<event_id, ClassifiedEvent>; rows whose LLM call
 *     failed are simply absent from the map.
 *
 * Cost note: at claude-3.5-haiku rates and ~25 summaries / 1.5k tokens per
 * batch, classifying 500 events ≈ $0.005 per mining run.
 */

import { chatCompletion } from "./openrouter";

/** The fixed taxonomy. Must match the strings the miner / dashboard expect. */
export const EVENT_TYPE_TAXONOMY = [
  "email_received",
  "email_sent",
  "email_replied",
  "email_forwarded",
  "meeting_scheduled",
  "meeting_held",
  "message_posted",
  "issue_created",
  "issue_updated",
  "issue_triaged",
  "bug_reported",
  "escalation_raised",
  "followup_assigned",
  "decision_made",
  "code_reviewed",
  "code_deployed",
  "pr_opened",
  "approval_given",
  "request_received",
  "info_shared",
  "doc_shared",
  "feature_discussed",
  "notification_received",
  "scheduling_request",
  "customer_interaction",
  "onboarding_event",
  "activity",
] as const;

export type EventTypeLabel = (typeof EVENT_TYPE_TAXONOMY)[number];

const TAXONOMY_SET = new Set<string>(EVENT_TYPE_TAXONOMY);

/** Input record for classification — one per timeline row. */
export interface ClassifiableEvent {
  /** Stable id (we use brain_timeline.id). */
  readonly id: string;
  /** The connector-supplied summary text (email subject, slack snippet, etc.). */
  readonly summary: string | null;
  /** Source system: gmail / slack / linear / calendar / github / ... */
  readonly source: string | null;
}

/** Output for a successfully classified event. */
export interface ClassifiedEvent {
  readonly id: string;
  readonly type: EventTypeLabel;
  /** Best-effort actor name ("Sarah Chen", "alice@…") or null. */
  readonly actor: string | null;
  /** Best-effort object reference ("LIN-487", "#triage", "PR #142") or null. */
  readonly objectRef: string | null;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MODEL = "anthropic/claude-3.5-haiku";

/**
 * Public entry point. Returns a Map keyed by event id; rows whose LLM call
 * failed (or whose returned type isn't in the taxonomy) are omitted. The
 * caller (mine/route.ts) falls back to its regex `deriveEventType` for
 * those rows.
 */
export async function classifyEvents(
  events: readonly ClassifiableEvent[],
  options?: {
    batchSize?: number;
    concurrency?: number;
    model?: string;
  },
): Promise<Map<string, ClassifiedEvent>> {
  const result = new Map<string, ClassifiedEvent>();

  // No early-bail on OPEN_ROUTER_API_KEY: in desktop mode that env var is
  // stripped from the bundled .env.production. chatCompletion() (used by
  // classifyBatch below) is mode-aware and routes through the cloud proxy
  // with a per-install device token. If the upstream call fails for any
  // reason, classifyBatch() returns [] and the caller falls back to the
  // regex deriveEventType per row.
  if (events.length === 0) {
    return result;
  }

  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const model = options?.model ?? DEFAULT_MODEL;

  // Dedup by summary+source so identical events share one classification.
  // For each dedup key we keep the first event as the "sample" sent to the
  // LLM, plus the list of every id sharing that key so we can fan the
  // result back out.
  const keyOf = (source: string | null, summary: string | null): string =>
    `${(source ?? "").toLowerCase()}|${(summary ?? "").trim().toLowerCase()}`;

  const idsByKey = new Map<string, string[]>();
  const samples: ClassifiableEvent[] = [];
  const keyById = new Map<string, string>();

  for (const e of events) {
    const k = keyOf(e.source, e.summary);
    keyById.set(e.id, k);
    const existing = idsByKey.get(k);
    if (existing) {
      existing.push(e.id);
    } else {
      idsByKey.set(k, [e.id]);
      samples.push(e);
    }
  }

  // Batch the samples.
  const batches: ClassifiableEvent[][] = [];
  for (let i = 0; i < samples.length; i += batchSize) {
    batches.push(samples.slice(i, i + batchSize));
  }

  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    const settled = await Promise.all(
      slice.map((batch) => classifyBatch(batch, model)),
    );

    for (const classifications of settled) {
      for (const c of classifications) {
        const k = keyById.get(c.id);
        const targetIds = (k && idsByKey.get(k)) || [c.id];
        for (const id of targetIds) {
          result.set(id, {
            id,
            type: c.type,
            actor: c.actor,
            objectRef: c.objectRef,
          });
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Classify one batch in a single LLM call. Returns [] on any failure.
 */
async function classifyBatch(
  batch: readonly ClassifiableEvent[],
  model: string,
): Promise<ClassifiedEvent[]> {
  try {
    const prompt = buildBatchPrompt(batch);
    const raw = await chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      {
        model,
        maxTokens: Math.min(2000, 80 * batch.length + 200),
        temperature: 0.1,
      },
    );

    if (!raw || !raw.trim()) return [];

    const cleaned = raw.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];

    const idsInBatch = new Set(batch.map((e) => e.id));
    const out: ClassifiedEvent[] = [];

    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : null;
      const type = typeof r.type === "string" ? r.type : null;
      if (!id || !type) continue;
      if (!idsInBatch.has(id)) continue;
      if (!TAXONOMY_SET.has(type)) continue;

      out.push({
        id,
        type: type as EventTypeLabel,
        actor: stringOrNull(r.actor),
        objectRef: stringOrNull(r.objectRef ?? r.object_ref),
      });
    }

    return out;
  } catch {
    return [];
  }
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
    return null;
  }
  return trimmed.slice(0, 80);
}

const SYSTEM_PROMPT = [
  "You classify workplace events into a fixed taxonomy of workflow event types.",
  "You receive a JSON array of events from tools like Gmail, Slack, Linear, Calendar, GitHub.",
  "For each event, choose exactly one type from the provided list and extract a coarse actor and object reference if present.",
  "",
  "Rules:",
  "- The 'type' MUST be one of the listed strings — never invent new types.",
  "- 'actor' is the human person or service that performed the action ('Sarah Chen', 'github-actions', 'noreply@…'), or null.",
  "- 'objectRef' is a stable identifier referenced by the event ('LIN-487', '#triage', 'PR #142', 'Q4 launch plan'), or null.",
  "- Prefer specific verbs ('issue_created', 'meeting_scheduled') over generic fallbacks ('activity', 'email_received') when evidence supports it.",
  "- Output ONLY a JSON array, no markdown fences, no commentary.",
].join("\n");

function buildBatchPrompt(batch: readonly ClassifiableEvent[]): string {
  const taxonomy = EVENT_TYPE_TAXONOMY.join(", ");
  const lines = batch.map((e) => {
    const summary = (e.summary ?? "").trim() || "(no summary)";
    const source = e.source ?? "unknown";
    return `  { "id": ${JSON.stringify(e.id)}, "source": ${JSON.stringify(source)}, "summary": ${JSON.stringify(summary)} }`;
  });

  return [
    `Allowed types: ${taxonomy}`,
    ``,
    `Events:`,
    `[`,
    lines.join(",\n"),
    `]`,
    ``,
    `Respond with a JSON array of objects with this exact shape:`,
    `[{"id":"<same id>","type":"<one of the allowed types>","actor":"<name or null>","objectRef":"<ref or null>"}]`,
  ].join("\n");
}
