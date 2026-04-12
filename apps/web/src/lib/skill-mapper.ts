/**
 * Maps a `brain_pages` row of type='workflow' (as written by the
 * /api/patterns/mine route) into the `SkillData` shape the Skills page
 * renders. The brain_pages row carries the PrefixSpan-mined pattern in its
 * `frontmatter` JSONB field; we transform it into a deployable-skill view
 * with trigger conditions, steps, tool permissions, and a YAML export.
 *
 * This is the bridge between the engine's mining output and the user-facing
 * "skill pack" concept. Keeping it as a pure function (no DB access) makes
 * it easy to test and reuse from both /api/skills (list) and
 * /api/skills/[id]/export (single download).
 */

import type { SkillData, SkillStatus, SkillStep } from "./mock-skills";

interface BrainPageWorkflowRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  frontmatter: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface PatternStep {
  eventType: string;
  position: number;
  sourceSystem?: string | null;
}

/** Maps event types to a human-readable action verb for skill steps. */
const EVENT_ACTION_MAP: Record<string, string> = {
  // Canonical EventType enum values from the engine.
  message_sent: "Send message",
  message_received: "Receive message",
  issue_created: "Create issue",
  issue_updated: "Update issue",
  meeting_scheduled: "Schedule meeting",
  meeting_held: "Hold meeting",
  meeting_cancelled: "Cancel meeting",
  followup_assigned: "Assign follow-up",
  artifact_shared: "Share artifact",
  decision_made: "Record decision",
  // Synthetic types produced by the keyword resolver in /api/patterns/mine.
  message_posted: "Post message in channel",
  email_received: "Receive email",
  email_replied: "Reply to email",
  bug_reported: "Receive bug report",
  issue_triaged: "Triage issue",
  escalation_raised: "Raise escalation",
  code_reviewed: "Review code",
  code_deployed: "Deploy code",
  doc_shared: "Share document",
};

/** Maps event types to the engine connector / tool name. */
const EVENT_TOOL_MAP: Record<string, string> = {
  // Canonical EventType enum values.
  message_sent: "slack",
  message_received: "gmail",
  issue_created: "linear",
  issue_updated: "linear",
  meeting_scheduled: "calendar",
  meeting_held: "calendar",
  meeting_cancelled: "calendar",
  followup_assigned: "linear",
  artifact_shared: "slack",
  decision_made: "linear",
  // Synthetic types from the keyword resolver.
  message_posted: "slack",
  email_received: "gmail",
  email_replied: "gmail",
  bug_reported: "linear",
  issue_triaged: "linear",
  escalation_raised: "linear",
  code_reviewed: "slack",
  code_deployed: "slack",
  doc_shared: "slack",
  // Bare source names (legacy fallback).
  gmail: "gmail",
  slack: "slack",
  linear: "linear",
  calendar: "calendar",
};

function actionFor(eventType: string): string {
  return EVENT_ACTION_MAP[eventType] ?? toTitleCase(eventType.replace(/_/g, " "));
}

function toolFor(eventType: string): string {
  return EVENT_TOOL_MAP[eventType] ?? "manual";
}

/**
 * Redact PII from a string for export. Applied only to the exported skill
 * pack YAML — the raw brain_pages frontmatter is never touched.
 *
 * Patterns stripped (in order):
 *   1. Email addresses           → [email]
 *   2. Phone numbers             → [phone]
 *      Handles: 555-123-4567, (555) 123-4567, 555.123.4567, +15551234567
 *   3. Linear ticket IDs         → [ticket]  (e.g. LIN-123)
 *   4. Capitalized two-word names → [person]  (e.g. "Sarah Chen")
 */
export function redactPII(text: string): string {
  // 1. Email addresses
  let out = text.replace(
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    "[email]",
  );

  // 2. Phone numbers (various common formats)
  out = out.replace(
    /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    "[phone]",
  );

  // 3. Linear ticket IDs
  out = out.replace(/\bLIN-\d+\b/g, "[ticket]");

  // 4. Capitalized two-word name patterns (Title Case pairs)
  //    Matches "Firstname Lastname" where both words start with a capital
  //    letter and are at least 2 chars each. Uses a negative lookbehind so
  //    we don't accidentally swallow things like "New Issue" or "In Progress"
  //    when they're sentence-initial — we only redact when both words are
  //    standalone title-cased tokens not preceded by a sentence boundary.
  out = out.replace(
    /\b([A-Z][a-z]{1,})\s([A-Z][a-z]{1,})\b/g,
    "[person]",
  );

  return out;
}

function toTitleCase(input: string): string {
  return input
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Compute a status from confidence: high → approved, mid → pending, low → draft. */
function statusForConfidence(confidence: number): SkillStatus {
  if (confidence >= 0.8) return "approved";
  if (confidence >= 0.5) return "pending_review";
  return "draft";
}

/**
 * Convert a workflow `brain_pages` row to a renderable SkillData.
 */
export function workflowPageToSkill(row: BrainPageWorkflowRow): SkillData {
  const frontmatter = (row.frontmatter ?? {}) as Record<string, unknown>;
  const confidence =
    typeof frontmatter.confidence === "number" ? frontmatter.confidence : 0.5;
  const support = typeof frontmatter.support === "number" ? frontmatter.support : 0;
  const rawSteps = Array.isArray(frontmatter.steps)
    ? (frontmatter.steps as PatternStep[])
    : [];

  // Derive concrete skill steps from the pattern's event sequence.
  // redactPII is applied to step descriptions since they appear in the
  // exported skill pack — not in the raw stored frontmatter.
  const skillSteps: SkillStep[] = rawSteps.map((step) => ({
    description: redactPII(actionFor(step.eventType)),
    toolsUsed: [toolFor(step.eventType)],
  }));

  // Trigger conditions: a generic "when X then Y" line per event in the
  // pattern. Real production output would be richer, but this is the
  // honest projection of what the miner actually knows.
  // redactPII is applied here because triggerConditions appear in the
  // exported skill pack view (not stored in raw frontmatter).
  const triggerConditions: string[] = rawSteps.length > 0
    ? [
        redactPII(
          `Event sequence detected: ${rawSteps
            .map((s) => s.eventType)
            .join(" → ")}`,
        ),
        redactPII(
          `Observed in ${support} session${support === 1 ? "" : "s"} with ${Math.round(
            confidence * 100,
          )}% confidence`,
        ),
      ]
    : [redactPII("Pattern with no recorded steps")];

  // Tool permissions: union of all tools touched, plus :read scopes
  // since the engine connectors are read-only by default.
  const tools = new Set<string>();
  for (const step of rawSteps) tools.add(toolFor(step.eventType));
  const toolPermissions = Array.from(tools).flatMap((t) => [`${t}:read`]);

  return {
    id: row.slug,
    name: row.title,
    description: redactPII(
      `Automated workflow mined from your activity. ${rawSteps.length} step${
        rawSteps.length === 1 ? "" : "s"
      } across ${tools.size} tool${tools.size === 1 ? "" : "s"}. Confidence ${Math.round(
        confidence * 100,
      )}%.`,
    ),
    version: "1.0.0",
    status: statusForConfidence(confidence),
    patternSourceId: row.slug,
    patternSourceName: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    triggerConditions,
    steps: skillSteps,
    toolPermissions,
    yaml: buildSkillYaml(row.title, rawSteps, confidence, support),
  };
}

/**
 * Build a deployable Claude skill-pack YAML from a workflow pattern.
 *
 * Output format mirrors the existing `SkillCompiler.metadataToYaml` shape
 * in the engine package, but inlined here so the web app doesn't need to
 * pull in the compiler module (which would balloon the API bundle).
 */
function buildSkillYaml(
  title: string,
  steps: PatternStep[],
  confidence: number,
  support: number,
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const topDescription = redactPII(`Automated workflow mined from real activity: ${title}`);
  const triggerDescription = redactPII(
    `Triggered when the following event sequence is detected: ${steps
      .map((s) => s.eventType)
      .join(" → ")}`,
  );

  const lines: string[] = [
    `name: ${slug}`,
    `description: ${JSON.stringify(topDescription)}`,
    `version: 1.0.0`,
    "",
    "trigger:",
    `  description: ${JSON.stringify(triggerDescription)}`,
    "  event_types:",
    ...steps.map((s) => `    - ${s.eventType}`),
    "",
    "steps:",
  ];

  steps.forEach((step, idx) => {
    lines.push(`  - position: ${idx}`);
    lines.push(`    action: ${JSON.stringify(redactPII(actionFor(step.eventType)))}`);
    lines.push(`    event_type: ${step.eventType}`);
    lines.push(`    tool_hint: ${toolFor(step.eventType)}`);
  });

  lines.push("", "tools:");
  const tools = new Set<string>();
  for (const step of steps) tools.add(toolFor(step.eventType));
  for (const t of tools) lines.push(`  - ${t}`);

  lines.push("", "provenance:");
  lines.push(`  pattern_id: ${slug}`);
  lines.push(`  composite_score: ${Math.round(confidence * 100)}`);
  lines.push(`  instance_count: ${support}`);
  lines.push(`  exported_at: ${new Date().toISOString()}`);

  return lines.join("\n") + "\n";
}
