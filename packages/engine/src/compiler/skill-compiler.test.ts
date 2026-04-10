import { describe, it, expect } from "vitest";
import { EventType } from "../normalize/schema.js";
import type { PatternCandidate, ScoredPattern } from "../mining/scorer.js";
import { SkillCompiler, type CompilerInput } from "./skill-compiler.js";
import { SkillValidator } from "./validator.js";

// -- helpers -----------------------------------------------------------------

const FIXED_TIMESTAMP = "2026-04-07T00:00:00.000Z";

function makeScoredPattern(overrides: Partial<ScoredPattern> = {}): ScoredPattern {
  return {
    patternId: "pattern-1",
    name: "issue_created → message_sent",
    compositeScore: 75,
    breakdown: {
      frequency: 80,
      consistency: 90,
      completionRate: 60,
      automationPotential: 100,
    },
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<PatternCandidate> = {}): PatternCandidate {
  return {
    id: "pattern-1",
    name: "issue_created → message_sent",
    steps: [EventType.IssueCreated, EventType.MessageSent],
    instances: [
      { eventTypes: [EventType.IssueCreated, EventType.MessageSent], completed: true },
      { eventTypes: [EventType.IssueCreated, EventType.MessageSent], completed: true },
    ],
    ...overrides,
  };
}

function makeInput(
  scoredOverrides: Partial<ScoredPattern> = {},
  candidateOverrides: Partial<PatternCandidate> = {},
): CompilerInput {
  return {
    scored: makeScoredPattern(scoredOverrides),
    candidate: makeCandidate(candidateOverrides),
  };
}

// -- tests -------------------------------------------------------------------

describe("compiler/skill-compiler", () => {
  const compiler = new SkillCompiler();

  describe("compile", () => {
    it("produces a valid skill pack from a scored pattern", () => {
      const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);

      expect(pack.id).toBe("pattern-1");
      expect(pack.metadata.name).toBe("issue_created-message_sent");
      expect(pack.metadata.version).toBe("1.0.0");
      expect(pack.metadata.steps).toHaveLength(2);
      expect(pack.metadata.tools.length).toBeGreaterThan(0);
      expect(pack.testCases.length).toBeGreaterThanOrEqual(1);
    });

    it("is idempotent — same input produces same output", () => {
      const input = makeInput();
      const pack1 = compiler.compile(input, FIXED_TIMESTAMP);
      const pack2 = compiler.compile(input, FIXED_TIMESTAMP);

      expect(pack1).toEqual(pack2);
    });

    it("generates correct trigger event types", () => {
      const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);

      expect(pack.metadata.trigger.eventTypes).toEqual([
        EventType.IssueCreated,
        EventType.MessageSent,
      ]);
    });

    it("records provenance from scored pattern", () => {
      const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);

      expect(pack.metadata.provenance.patternId).toBe("pattern-1");
      expect(pack.metadata.provenance.compositeScore).toBe(75);
      expect(pack.metadata.provenance.instanceCount).toBe(2);
      expect(pack.metadata.provenance.exportedAt).toBe(FIXED_TIMESTAMP);
    });

    it("builds steps with actions and tool hints", () => {
      const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
      const steps = pack.metadata.steps;

      expect(steps[0].action).toBe("Create a new issue");
      expect(steps[0].eventType).toBe(EventType.IssueCreated);
      expect(steps[0].toolHint).toBe("Linear create issue");

      expect(steps[1].action).toBe("Send a message");
      expect(steps[1].eventType).toBe(EventType.MessageSent);
      expect(steps[1].toolHint).toBe("Slack/Gmail send");
    });
  });

  describe("metadataToYaml", () => {
    it("produces valid YAML-like output with all fields", () => {
      const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
      const yaml = compiler.metadataToYaml(pack.metadata);

      expect(yaml).toContain("name:");
      expect(yaml).toContain("trigger:");
      expect(yaml).toContain("steps:");
      expect(yaml).toContain("tools:");
      expect(yaml).toContain("provenance:");
      expect(yaml).toContain("pattern-1");
    });
  });

  describe("testCasesToYaml", () => {
    it("produces YAML with test case entries", () => {
      const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
      const yaml = compiler.testCasesToYaml(pack.testCases);

      expect(yaml).toContain("test_cases:");
      expect(yaml).toContain("happy-path");
      expect(yaml).toContain("partial-completion");
    });

    it("returns empty array YAML for no test cases", () => {
      const yaml = compiler.testCasesToYaml([]);
      expect(yaml).toBe("test_cases: []\n");
    });
  });

  describe("skillMd", () => {
    it("contains frontmatter, trigger, steps, tools, and provenance sections", () => {
      const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
      const md = pack.skillMd;

      expect(md).toContain("---");
      expect(md).toContain("## Trigger");
      expect(md).toContain("## Steps");
      expect(md).toContain("## Tools Required");
      expect(md).toContain("## Provenance");
      expect(md).toContain("pattern-1");
      expect(md).toContain("75/100");
    });
  });

  describe("edge cases", () => {
    it("handles single-step pattern", () => {
      const input = makeInput(
        { name: "issue_created" },
        {
          steps: [EventType.IssueCreated],
          instances: [{ eventTypes: [EventType.IssueCreated], completed: true }],
        },
      );
      const pack = compiler.compile(input, FIXED_TIMESTAMP);

      expect(pack.metadata.steps).toHaveLength(1);
      // Single-step patterns get only the happy-path test (no partial)
      expect(pack.testCases).toHaveLength(1);
      expect(pack.testCases[0].name).toBe("happy-path");
    });

    it("handles pattern with decision steps (no tool hint)", () => {
      const input = makeInput(
        { name: "decision_made → issue_created" },
        {
          steps: [EventType.DecisionMade, EventType.IssueCreated],
          instances: [
            {
              eventTypes: [EventType.DecisionMade, EventType.IssueCreated],
              completed: true,
            },
          ],
        },
      );
      const pack = compiler.compile(input, FIXED_TIMESTAMP);

      // decision_made has "manual review" which is excluded from tools
      expect(pack.metadata.tools).not.toContain("manual review");
      expect(pack.metadata.steps[0].toolHint).toBe("manual review");
    });
  });
});

describe("compiler/security", () => {
  const compiler = new SkillCompiler();

  describe("toSkillId strips path separators", () => {
    it("strips forward slashes", () => {
      expect(compiler.toSkillId("../../etc/passwd")).toBe("etc-passwd");
    });

    it("strips dots used for traversal", () => {
      expect(compiler.toSkillId("..\\..\\windows\\system32")).toBe("windows-system32");
    });

    it("strips mixed separators", () => {
      expect(compiler.toSkillId("foo/bar\\baz.qux")).toBe("foo-bar-baz-qux");
    });

    it("handles normal pattern IDs unchanged", () => {
      expect(compiler.toSkillId("pattern-1")).toBe("pattern-1");
    });
  });

  describe("YAML quoting for special characters", () => {
    it("quotes strings containing colon-space", () => {
      const input = makeInput(
        { name: "key: value pattern" },
        { steps: [EventType.IssueCreated], instances: [{ eventTypes: [EventType.IssueCreated], completed: true }] },
      );
      const pack = compiler.compile(input, FIXED_TIMESTAMP);
      const yaml = compiler.metadataToYaml(pack.metadata);
      // The description contains the original name with colon-space, which must be quoted
      expect(yaml).toContain('"Automated workflow: key: value pattern');
    });

    it("quotes strings containing hash", () => {
      const input = makeInput(
        { name: "pattern #1" },
        { steps: [EventType.IssueCreated], instances: [{ eventTypes: [EventType.IssueCreated], completed: true }] },
      );
      const pack = compiler.compile(input, FIXED_TIMESTAMP);
      const yaml = compiler.metadataToYaml(pack.metadata);
      // The name gets transformed by toSkillName, but description contains it
      expect(yaml).toContain('description: "Automated workflow: pattern #1');
    });

    it("quotes strings containing brackets", () => {
      const input = makeInput(
        { name: "[test] workflow" },
        { steps: [EventType.IssueCreated], instances: [{ eventTypes: [EventType.IssueCreated], completed: true }] },
      );
      const pack = compiler.compile(input, FIXED_TIMESTAMP);
      const yaml = compiler.metadataToYaml(pack.metadata);
      expect(yaml).toContain('"Automated workflow: [test] workflow');
    });

    it("quotes strings containing curly braces", () => {
      const input = makeInput(
        { name: "{test} workflow" },
        { steps: [EventType.IssueCreated], instances: [{ eventTypes: [EventType.IssueCreated], completed: true }] },
      );
      const pack = compiler.compile(input, FIXED_TIMESTAMP);
      const yaml = compiler.metadataToYaml(pack.metadata);
      expect(yaml).toContain('"Automated workflow: {test} workflow');
    });

    it("escapes double quotes inside values", () => {
      const testCases = [{
        name: 'test with "quotes"',
        description: 'A "quoted" test',
        inputEvents: ["issue_created"],
        expectedSteps: ["issue_created"],
      }];
      const yaml = compiler.testCasesToYaml(testCases);
      expect(yaml).toContain('"test with \\"quotes\\""');
      expect(yaml).toContain('"A \\"quoted\\" test"');
    });
  });
});

describe("compiler/validator", () => {
  const compiler = new SkillCompiler();
  const validator = new SkillValidator();

  it("passes validation for a well-formed skill pack", () => {
    const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
    const result = validator.validate(pack);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails on empty id", () => {
    const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
    const badPack = { ...pack, id: "" };
    const result = validator.validate(badPack);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Skill pack must have a non-empty id");
  });

  it("fails on missing steps", () => {
    const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
    const badMeta = { ...pack.metadata, steps: [] };
    const badPack = { ...pack, metadata: badMeta };
    const result = validator.validate(badPack);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("steps"))).toBe(true);
  });

  it("fails on empty skillMd", () => {
    const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
    const badPack = { ...pack, skillMd: "" };
    const result = validator.validate(badPack);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("skillMd"))).toBe(true);
  });

  it("fails on no test cases", () => {
    const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
    const badPack = { ...pack, testCases: [] };
    const result = validator.validate(badPack);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("test case"))).toBe(true);
  });

  it("fails on invalid version", () => {
    const pack = compiler.compile(makeInput(), FIXED_TIMESTAMP);
    const badMeta = { ...pack.metadata, version: "abc" };
    const badPack = { ...pack, metadata: badMeta };
    const result = validator.validate(badPack);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("semver"))).toBe(true);
  });
});
