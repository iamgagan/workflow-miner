/**
 * Multi-format exporters for mined workflow patterns.
 *
 * A single mined pattern can be compiled to any of these deployment
 * targets — Workflow Miner is the discovery layer; the runtime is
 * whichever tool the user prefers.
 *
 *   claude  → Claude skill pack YAML (existing format)
 *   n8n     → n8n workflow JSON (importable via Workflows → Import)
 *   zapier  → Zapier Zap template JSON (for "Create Zap from template")
 *   json    → Generic workflow spec JSON (for custom runtimes / LLMs)
 *
 * All exporters consume the same input shape so they stay in sync when
 * the underlying pattern model evolves.
 */

import { redactPII } from "./skill-mapper";

export type ExportFormat = "claude" | "n8n" | "zapier" | "json";

export interface ExportableWorkflow {
  readonly slug: string;
  readonly title: string;
  readonly steps: ReadonlyArray<{
    readonly eventType: string;
    readonly position: number;
    readonly sourceSystem?: string | null;
  }>;
  readonly confidence: number;
  readonly support: number;
}

/** Extensions + mime types per format for the export response headers. */
export const FORMAT_META: Record<ExportFormat, { ext: string; mime: string }> = {
  claude: { ext: "skill.yaml", mime: "application/x-yaml; charset=utf-8" },
  n8n: { ext: "n8n.json", mime: "application/json; charset=utf-8" },
  zapier: { ext: "zap.json", mime: "application/json; charset=utf-8" },
  json: { ext: "workflow.json", mime: "application/json; charset=utf-8" },
};

const EVENT_ACTION_MAP: Record<string, string> = {
  message_sent: "Send message",
  message_received: "Receive message",
  issue_created: "Create issue",
  issue_updated: "Update issue",
  issue_closed: "Close issue",
  meeting_scheduled: "Schedule meeting",
  meeting_held: "Hold meeting",
  meeting_cancelled: "Cancel meeting",
  followup_assigned: "Assign follow-up",
  artifact_shared: "Share artifact",
  decision_made: "Record decision",
  pr_opened: "Open pull request",
  pr_merged: "Merge pull request",
  review_submitted: "Submit review",
  commit_pushed: "Push commit",
  comment_added: "Add comment",
  doc_created: "Create document",
  doc_updated: "Update document",
};

const EVENT_TOOL_MAP: Record<string, string> = {
  message_sent: "slack",
  message_received: "gmail",
  issue_created: "linear",
  issue_updated: "linear",
  issue_closed: "linear",
  meeting_scheduled: "calendar",
  meeting_held: "calendar",
  meeting_cancelled: "calendar",
  followup_assigned: "linear",
  artifact_shared: "slack",
  decision_made: "linear",
  pr_opened: "github",
  pr_merged: "github",
  review_submitted: "github",
  commit_pushed: "github",
  comment_added: "linear",
  doc_created: "notion",
  doc_updated: "notion",
};

function actionFor(eventType: string): string {
  return EVENT_ACTION_MAP[eventType] ?? eventType.replace(/_/g, " ");
}

function toolFor(eventType: string): string {
  return EVENT_TOOL_MAP[eventType] ?? "manual";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Claude skill pack (YAML) ─────────────────────────────────────────

function exportClaude(w: ExportableWorkflow): string {
  const slug = slugify(w.title);
  const topDescription = redactPII(
    `Automated workflow mined from real activity: ${w.title}`,
  );
  const triggerDescription = redactPII(
    `Triggered when the following event sequence is detected: ${w.steps
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
    ...w.steps.map((s) => `    - ${s.eventType}`),
    "",
    "steps:",
  ];

  w.steps.forEach((step, idx) => {
    lines.push(`  - position: ${idx}`);
    lines.push(`    action: ${JSON.stringify(redactPII(actionFor(step.eventType)))}`);
    lines.push(`    event_type: ${step.eventType}`);
    lines.push(`    tool_hint: ${toolFor(step.eventType)}`);
  });

  lines.push("", "tools:");
  const tools = new Set<string>();
  for (const step of w.steps) tools.add(toolFor(step.eventType));
  for (const t of tools) lines.push(`  - ${t}`);

  lines.push("", "provenance:");
  lines.push(`  pattern_id: ${slug}`);
  lines.push(`  composite_score: ${Math.round(w.confidence * 100)}`);
  lines.push(`  instance_count: ${w.support}`);
  lines.push(`  exported_at: ${new Date().toISOString()}`);

  return lines.join("\n") + "\n";
}

// ─── n8n workflow JSON ────────────────────────────────────────────────

/**
 * n8n uses a node graph: each step becomes an n8n node, connected sequentially.
 * We emit canonical node types so the workflow imports cleanly; users can
 * wire in credentials after import.
 *
 * See https://docs.n8n.io/workflows/export-import/ for the schema.
 */
const N8N_NODE_TYPE: Record<string, string> = {
  slack: "n8n-nodes-base.slack",
  gmail: "n8n-nodes-base.gmail",
  linear: "n8n-nodes-base.linear",
  calendar: "n8n-nodes-base.googleCalendar",
  github: "n8n-nodes-base.github",
  notion: "n8n-nodes-base.notion",
  jira: "n8n-nodes-base.jira",
  outlook: "n8n-nodes-base.microsoftOutlook",
};

function exportN8n(w: ExportableWorkflow): string {
  const slug = slugify(w.title);
  const nodes: Array<Record<string, unknown>> = [];
  const connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }> = {};

  // Manual trigger so the workflow is runnable after import
  nodes.push({
    parameters: {},
    name: "Trigger",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [240, 300],
    id: "trigger",
  });

  let prevName = "Trigger";
  w.steps.forEach((step, idx) => {
    const tool = toolFor(step.eventType);
    const nodeName = `Step ${idx + 1}: ${actionFor(step.eventType)}`;
    const nodeType = N8N_NODE_TYPE[tool] ?? "n8n-nodes-base.noOp";
    const x = 440 + idx * 220;

    nodes.push({
      parameters: {
        notice: redactPII(`${actionFor(step.eventType)} (${tool})`),
      },
      name: nodeName,
      type: nodeType,
      typeVersion: 1,
      position: [x, 300],
      id: `step-${idx}`,
      notes: redactPII(
        `Event type: ${step.eventType}\nTool: ${tool}\n\nConfigure credentials and parameters for this node after import.`,
      ),
      notesInFlow: true,
    });

    connections[prevName] = {
      main: [[{ node: nodeName, type: "main", index: 0 }]],
    };
    prevName = nodeName;
  });

  const workflow = {
    name: `[Workflow Miner] ${w.title}`,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: "v1" },
    meta: {
      workflowMinerPatternId: slug,
      compositeScore: Math.round(w.confidence * 100),
      instanceCount: w.support,
      exportedAt: new Date().toISOString(),
    },
    tags: ["workflow-miner", "imported"],
  };

  return JSON.stringify(workflow, null, 2);
}

// ─── Zapier template JSON ─────────────────────────────────────────────

/**
 * Zapier has a Zap template format used by the Developer Platform when
 * authors publish shared Zaps. Each step has an `app`, `event`, and params.
 * This is a template (not a deployable Zap) — users click "Create Zap from
 * this template" and Zapier walks them through wiring credentials.
 *
 * See https://platform.zapier.com/docs for the reference schema.
 */
const ZAPIER_APP_MAP: Record<string, { app: string; triggerEvent: string; actionEvent: string }> = {
  slack: { app: "slack", triggerEvent: "new_message_posted_anywhere", actionEvent: "send_channel_message" },
  gmail: { app: "gmail", triggerEvent: "new_email", actionEvent: "send_email" },
  linear: { app: "linear", triggerEvent: "new_issue", actionEvent: "create_issue" },
  calendar: { app: "google-calendar", triggerEvent: "new_event", actionEvent: "create_detailed_event" },
  github: { app: "github", triggerEvent: "new_issue", actionEvent: "create_issue" },
  notion: { app: "notion", triggerEvent: "new_database_item", actionEvent: "create_database_item" },
  jira: { app: "jira-software-cloud", triggerEvent: "new_issue", actionEvent: "create_issue" },
  outlook: { app: "microsoft-outlook", triggerEvent: "new_email", actionEvent: "send_email" },
};

function exportZapier(w: ExportableWorkflow): string {
  const slug = slugify(w.title);
  const steps = w.steps.map((step, idx) => {
    const tool = toolFor(step.eventType);
    const mapping = ZAPIER_APP_MAP[tool] ?? { app: "webhooks", triggerEvent: "catch_hook", actionEvent: "post" };
    const isFirst = idx === 0;

    return {
      id: `step-${idx}`,
      type: isFirst ? "trigger" : "action",
      app: mapping.app,
      event: isFirst ? mapping.triggerEvent : mapping.actionEvent,
      label: redactPII(`Step ${idx + 1}: ${actionFor(step.eventType)}`),
      description: redactPII(
        `Event type: ${step.eventType}. Configure this step's parameters after importing.`,
      ),
      params: {},
    };
  });

  const template = {
    title: redactPII(`[Workflow Miner] ${w.title}`),
    description: redactPII(
      `Workflow mined from real activity across ${
        new Set(w.steps.map((s) => toolFor(s.eventType))).size
      } tools. Confidence ${Math.round(w.confidence * 100)}%.`,
    ),
    steps,
    meta: {
      workflowMinerPatternId: slug,
      compositeScore: Math.round(w.confidence * 100),
      instanceCount: w.support,
      exportedAt: new Date().toISOString(),
    },
  };

  return JSON.stringify(template, null, 2);
}

// ─── Generic JSON spec ────────────────────────────────────────────────

/**
 * Runtime-agnostic JSON representation. Useful for custom agent frameworks,
 * LLM prompts that need structured workflow context, or bespoke runners.
 */
function exportJson(w: ExportableWorkflow): string {
  const slug = slugify(w.title);
  const spec = {
    $schema: "https://workflow-miner.dev/schemas/workflow/v1.json",
    id: slug,
    name: redactPII(w.title),
    description: redactPII(
      `Automated workflow mined from real activity across ${w.steps.length} step${
        w.steps.length === 1 ? "" : "s"
      }.`,
    ),
    version: "1.0.0",
    confidence: w.confidence,
    instanceCount: w.support,
    trigger: {
      type: "event_sequence",
      events: w.steps.map((s) => s.eventType),
    },
    steps: w.steps.map((step, idx) => ({
      position: idx,
      eventType: step.eventType,
      action: redactPII(actionFor(step.eventType)),
      tool: toolFor(step.eventType),
      sourceSystem: step.sourceSystem ?? null,
    })),
    tools: Array.from(new Set(w.steps.map((s) => toolFor(s.eventType)))),
    exportedAt: new Date().toISOString(),
  };

  return JSON.stringify(spec, null, 2);
}

// ─── Dispatcher ───────────────────────────────────────────────────────

export function exportWorkflow(
  workflow: ExportableWorkflow,
  format: ExportFormat,
): string {
  switch (format) {
    case "claude":
      return exportClaude(workflow);
    case "n8n":
      return exportN8n(workflow);
    case "zapier":
      return exportZapier(workflow);
    case "json":
      return exportJson(workflow);
  }
}

export function isValidFormat(format: string | null | undefined): format is ExportFormat {
  return format === "claude" || format === "n8n" || format === "zapier" || format === "json";
}
