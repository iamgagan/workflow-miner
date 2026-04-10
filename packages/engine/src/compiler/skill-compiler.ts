import type { PatternCandidate, ScoredPattern } from "../mining/scorer.js";
import type { EventType } from "../normalize/schema.js";

/**
 * Input to the skill compiler: a scored pattern with its candidate data.
 */
export interface CompilerInput {
  readonly scored: ScoredPattern;
  readonly candidate: PatternCandidate;
}

/**
 * A compiled skill pack ready to be written to disk.
 */
export interface SkillPack {
  readonly id: string;
  readonly metadata: SkillMetadata;
  readonly skillMd: string;
  readonly testCases: readonly SkillTestCase[];
}

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly trigger: SkillTrigger;
  readonly steps: readonly SkillStep[];
  readonly tools: readonly string[];
  readonly provenance: SkillProvenance;
}

export interface SkillTrigger {
  readonly description: string;
  readonly eventTypes: readonly string[];
}

export interface SkillStep {
  readonly position: number;
  readonly action: string;
  readonly eventType: string;
  readonly toolHint: string | null;
}

export interface SkillProvenance {
  readonly patternId: string;
  readonly compositeScore: number;
  readonly instanceCount: number;
  readonly exportedAt: string;
}

export interface SkillTestCase {
  readonly name: string;
  readonly description: string;
  readonly inputEvents: readonly string[];
  readonly expectedSteps: readonly string[];
}

/** Maps event types to tool hints for the generated skill. */
const EVENT_TOOL_MAP: Readonly<Record<string, string>> = {
  message_sent: "Slack/Gmail send",
  message_received: "Slack/Gmail read",
  issue_created: "Linear create issue",
  issue_updated: "Linear update issue",
  meeting_scheduled: "Calendar create event",
  meeting_held: "Calendar read event",
  followup_assigned: "Linear create issue",
  artifact_shared: "Slack/Gmail send",
  decision_made: "manual review",
};

/** Characters/patterns that require YAML quoting. */
const YAML_NEEDS_QUOTING = /[:\#\[\]\{\}|>&*!,?'"]|^\s|\s$|\n/;

/** Quote a YAML scalar value if it contains special characters. */
function yamlScalar(value: string | number): string {
  if (typeof value === "number") return String(value);
  if (YAML_NEEDS_QUOTING.test(value)) {
    // Use double-quote style, escaping embedded double-quotes and backslashes
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    return `"${escaped}"`;
  }
  return value;
}

/** Maps event types to human-readable action descriptions. */
const EVENT_ACTION_MAP: Readonly<Record<string, string>> = {
  message_sent: "Send a message",
  message_received: "Receive a message",
  issue_created: "Create a new issue",
  issue_updated: "Update an existing issue",
  meeting_scheduled: "Schedule a meeting",
  meeting_held: "Hold a meeting",
  followup_assigned: "Assign a follow-up task",
  artifact_shared: "Share an artifact",
  decision_made: "Make a decision",
};

/**
 * Compiles scored patterns into deployable Claude skill packs.
 *
 * The output is deterministic: the same input pattern always produces
 * the same skill pack (idempotent).
 */
export class SkillCompiler {
  /**
   * Compile a single scored pattern into a skill pack.
   * @param exportedAt - Fixed timestamp for deterministic output. Defaults to now.
   */
  compile(input: CompilerInput, exportedAt?: string): SkillPack {
    const { scored, candidate } = input;
    const timestamp = exportedAt ?? new Date().toISOString();
    const skillId = this.toSkillId(scored.patternId);

    const metadata = this.buildMetadata(scored, candidate, timestamp);
    const skillMd = this.renderSkillMd(metadata, scored);
    const testCases = this.buildTestCases(candidate);

    return {
      id: skillId,
      metadata,
      skillMd,
      testCases,
    };
  }

  /**
   * Serialize a skill pack's metadata to YAML format.
   */
  metadataToYaml(metadata: SkillMetadata): string {
    const lines: string[] = [
      `name: ${yamlScalar(metadata.name)}`,
      `description: ${yamlScalar(metadata.description)}`,
      `version: ${yamlScalar(metadata.version)}`,
      "",
      "trigger:",
      `  description: ${yamlScalar(metadata.trigger.description)}`,
      "  event_types:",
      ...metadata.trigger.eventTypes.map((e) => `    - ${yamlScalar(e)}`),
      "",
      "steps:",
      ...metadata.steps.flatMap((s) => [
        `  - position: ${s.position}`,
        `    action: ${yamlScalar(s.action)}`,
        `    event_type: ${yamlScalar(s.eventType)}`,
        ...(s.toolHint ? [`    tool_hint: ${yamlScalar(s.toolHint)}`] : []),
      ]),
      "",
      "tools:",
      ...metadata.tools.map((t) => `  - ${yamlScalar(t)}`),
      "",
      "provenance:",
      `  pattern_id: ${yamlScalar(metadata.provenance.patternId)}`,
      `  composite_score: ${metadata.provenance.compositeScore}`,
      `  instance_count: ${metadata.provenance.instanceCount}`,
      `  exported_at: ${yamlScalar(metadata.provenance.exportedAt)}`,
    ];

    return lines.join("\n") + "\n";
  }

  /**
   * Serialize test cases to YAML format.
   */
  testCasesToYaml(testCases: readonly SkillTestCase[]): string {
    if (testCases.length === 0) return "test_cases: []\n";

    const lines: string[] = ["test_cases:"];
    for (const tc of testCases) {
      lines.push(
        `  - name: ${yamlScalar(tc.name)}`,
        `    description: ${yamlScalar(tc.description)}`,
        "    input_events:",
        ...tc.inputEvents.map((e) => `      - ${yamlScalar(e)}`),
        "    expected_steps:",
        ...tc.expectedSteps.map((s) => `      - ${yamlScalar(s)}`),
      );
    }

    return lines.join("\n") + "\n";
  }

  // -- private helpers -------------------------------------------------------

  toSkillId(patternId: string): string {
    return patternId
      .replace(/[\/\\.]/g, "-")
      .replace(/[^a-z0-9-]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  private buildMetadata(
    scored: ScoredPattern,
    candidate: PatternCandidate,
    exportedAt: string,
  ): SkillMetadata {
    const steps = this.buildSteps(candidate.steps);
    const tools = this.extractTools(candidate.steps);
    const triggerEventTypes = candidate.steps.map((s) => s as string);

    return {
      name: this.toSkillName(scored.name),
      description: `Automated workflow: ${scored.name}. Confidence score: ${scored.compositeScore}/100.`,
      version: "1.0.0",
      trigger: {
        description: `Triggered when the following event sequence is detected: ${scored.name}`,
        eventTypes: triggerEventTypes,
      },
      steps,
      tools,
      provenance: {
        patternId: scored.patternId,
        compositeScore: scored.compositeScore,
        instanceCount: candidate.instances.length,
        exportedAt,
      },
    };
  }

  private buildSteps(eventTypes: readonly EventType[]): readonly SkillStep[] {
    return eventTypes.map((et, idx) => ({
      position: idx,
      action: EVENT_ACTION_MAP[et] ?? `Handle ${et}`,
      eventType: et,
      toolHint: EVENT_TOOL_MAP[et] ?? null,
    }));
  }

  private extractTools(eventTypes: readonly EventType[]): readonly string[] {
    const tools = new Set<string>();
    for (const et of eventTypes) {
      const tool = EVENT_TOOL_MAP[et];
      if (tool && tool !== "manual review") {
        tools.add(tool);
      }
    }
    return [...tools].sort();
  }

  private toSkillName(patternName: string): string {
    return patternName
      .replace(/\s*→\s*/g, "-")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  private renderSkillMd(metadata: SkillMetadata, scored: ScoredPattern): string {
    const stepList = metadata.steps
      .map(
        (s, i) =>
          `${i + 1}. **${s.action}** (\`${s.eventType}\`)${s.toolHint ? ` — tool: ${s.toolHint}` : ""}`,
      )
      .join("\n");

    return [
      "---",
      `name: ${metadata.name}`,
      `description: ${metadata.description}`,
      "---",
      "",
      `# ${metadata.name}`,
      "",
      metadata.description,
      "",
      "## Trigger",
      "",
      metadata.trigger.description,
      "",
      "## Steps",
      "",
      stepList,
      "",
      "## Tools Required",
      "",
      ...metadata.tools.map((t) => `- ${t}`),
      "",
      "## Provenance",
      "",
      `- Pattern ID: \`${scored.patternId}\``,
      `- Composite Score: ${scored.compositeScore}/100`,
      `- Frequency: ${scored.breakdown.frequency}`,
      `- Consistency: ${scored.breakdown.consistency}`,
      `- Completion Rate: ${scored.breakdown.completionRate}`,
      `- Automation Potential: ${scored.breakdown.automationPotential}`,
      "",
    ].join("\n");
  }

  private buildTestCases(
    candidate: PatternCandidate,
  ): readonly SkillTestCase[] {
    const steps = candidate.steps.map((s) => s as string);

    const cases: SkillTestCase[] = [
      {
        name: "happy-path",
        description: "All steps fire in order",
        inputEvents: steps,
        expectedSteps: steps,
      },
    ];

    // Add a partial-completion test if pattern has 2+ steps
    if (steps.length >= 2) {
      cases.push({
        name: "partial-completion",
        description: "Only the first step fires",
        inputEvents: [steps[0]],
        expectedSteps: [steps[0]],
      });
    }

    return cases;
  }
}
