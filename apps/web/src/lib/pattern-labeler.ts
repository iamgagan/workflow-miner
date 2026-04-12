/**
 * LLM-assisted pattern labeling.
 *
 * Given a list of scored patterns and their supporting evidence events,
 * calls OpenRouter (claude-3.5-haiku) to generate a human-readable name
 * and one-sentence description for each pattern.
 *
 * Fails gracefully: if OPEN_ROUTER_API_KEY is not set, or if any LLM call
 * errors (network, parse, rate-limit), the pattern keeps its mechanically-
 * generated name and an empty description. Mining never fails because of
 * the LLM step.
 *
 * Concurrency is capped at 3 simultaneous requests to avoid rate limits.
 */

import { chatCompletion } from "./openrouter";

/** Minimal shape of a mined pattern we need for labeling. */
export interface LabelablePattern {
  id: string;
  /** Mechanically-generated name, e.g. "email_received → issue_created → meeting_scheduled" */
  name: string;
  /** Ordered step event types. */
  steps: ReadonlyArray<{ eventType: string }>;
  /** 0-100 composite score (or 0 if scoring was skipped). */
  compositeScore?: number;
}

/** Evidence event metadata for a single pattern (from the mined timeline rows). */
export interface EvidenceEvent {
  summary: string | null;
  source: string | null;
  timestamp: string;
}

/**
 * Map from patternId → array of evidence events.
 * Callers should populate this from the timeline rows whose IDs are in
 * `pattern.evidenceEventIds`.
 */
export type EvidenceMap = Map<string, EvidenceEvent[]>;

export interface PatternLabel {
  /** Human-readable name (max 60 chars). Falls back to `pattern.name`. */
  name: string;
  /** One-sentence description. Empty string on failure. */
  description: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the user prompt for a single pattern.
 */
function buildPrompt(pattern: LabelablePattern, evidence: EvidenceEvent[]): string {
  const stepSequence = pattern.steps.map((s) => s.eventType).join(" → ");
  const score = pattern.compositeScore ?? 0;

  const evidenceLines = evidence
    .slice(0, 10) // keep the prompt compact
    .map((e, i) => {
      const ts = e.timestamp ? new Date(e.timestamp).toISOString() : "unknown";
      const src = e.source ?? "unknown";
      const summary = (e.summary ?? "").trim() || "(no summary)";
      return `  ${i + 1}. [${ts}] (${src}) ${summary}`;
    })
    .join("\n");

  return [
    `You are labeling a workflow pattern discovered by a mining algorithm.`,
    ``,
    `Step sequence: ${stepSequence}`,
    `Composite score: ${score}/100`,
    ``,
    `Evidence events (up to 10 samples):`,
    evidenceLines || "  (none)",
    ``,
    `Respond with ONLY a JSON object (no markdown fences) in this exact shape:`,
    `{"name":"<concise human-readable name, max 60 chars>","description":"<one sentence description>"}`,
    ``,
    `The name should describe what this workflow accomplishes (e.g. "Bug Report to Triage Escalation").`,
    `The description should explain when/why this workflow occurs in plain English.`,
  ].join("\n");
}

/**
 * Call the LLM for a single pattern and return a label, or null on failure.
 */
async function labelOne(
  pattern: LabelablePattern,
  evidence: EvidenceEvent[],
): Promise<PatternLabel | null> {
  try {
    const userPrompt = buildPrompt(pattern, evidence);
    const raw = await chatCompletion(
      [{ role: "user", content: userPrompt }],
      { maxTokens: 150, temperature: 0.3 },
    );

    if (!raw || !raw.trim()) return null;

    // Strip accidental markdown fences if the model adds them anyway.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as { name?: unknown; description?: unknown };

    const name =
      typeof parsed.name === "string" && parsed.name.trim().length > 0
        ? parsed.name.trim().slice(0, 60)
        : null;
    const description =
      typeof parsed.description === "string" ? parsed.description.trim() : "";

    if (!name) return null;
    return { name, description };
  } catch {
    // Network error, parse error, missing API key — all silently ignored.
    return null;
  }
}

/**
 * Run LLM labeling over a list of patterns in parallel, capped at 3
 * concurrent requests. Returns a Map from patternId → PatternLabel.
 *
 * Patterns whose LLM call fails get their original `pattern.name` and an
 * empty description, so callers can always rely on the map being fully
 * populated.
 */
export async function labelPatterns(
  patterns: LabelablePattern[],
  evidenceMap: EvidenceMap,
): Promise<Map<string, PatternLabel>> {
  const result = new Map<string, PatternLabel>();

  // If there's no API key configured, skip LLM entirely.
  if (!process.env.OPEN_ROUTER_API_KEY) {
    for (const p of patterns) {
      result.set(p.id, { name: p.name, description: "" });
    }
    return result;
  }

  const CONCURRENCY = 3;

  // Process in batches of CONCURRENCY.
  for (let i = 0; i < patterns.length; i += CONCURRENCY) {
    const batch = patterns.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (pattern) => {
        const evidence = evidenceMap.get(pattern.id) ?? [];
        const label = await labelOne(pattern, evidence);
        return {
          id: pattern.id,
          label: label ?? { name: pattern.name, description: "" },
        };
      }),
    );
    for (const { id, label } of batchResults) {
      result.set(id, label);
    }
  }

  return result;
}
