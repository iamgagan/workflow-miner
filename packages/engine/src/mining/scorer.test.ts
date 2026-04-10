import { describe, it, expect } from "vitest";
import { EventType } from "../normalize/schema.js";
import {
  PatternScorer,
  type PatternCandidate,
  type PatternInstance,
} from "./scorer.js";

// -- helpers --------------------------------------------------------------

function instance(
  eventTypes: EventType[],
  completed = true,
): PatternInstance {
  return { eventTypes, completed };
}

function candidate(
  overrides: Partial<PatternCandidate> & { id: string },
): PatternCandidate {
  return {
    name: "Test Pattern",
    steps: [EventType.IssueCreated, EventType.MessageSent],
    instances: [],
    ...overrides,
  };
}

// -- tests ----------------------------------------------------------------

describe("mining/scorer", () => {
  const scorer = new PatternScorer();

  describe("frequency scoring", () => {
    it("gives 100 to the most-frequent pattern", () => {
      const candidates = [
        candidate({
          id: "a",
          instances: [
            instance([EventType.IssueCreated]),
            instance([EventType.IssueCreated]),
            instance([EventType.IssueCreated]),
          ],
        }),
        candidate({
          id: "b",
          instances: [instance([EventType.IssueCreated])],
        }),
      ];

      const results = scorer.scoreAll(candidates);
      const a = results.find((r) => r.patternId === "a")!;
      const b = results.find((r) => r.patternId === "b")!;

      expect(a.breakdown.frequency).toBe(100);
      expect(b.breakdown.frequency).toBe(33);
    });

    it("handles a single candidate (frequency = 100)", () => {
      const results = scorer.scoreAll([
        candidate({
          id: "only",
          instances: [instance([EventType.IssueCreated])],
        }),
      ]);

      expect(results[0].breakdown.frequency).toBe(100);
    });
  });

  describe("consistency scoring (Jaccard)", () => {
    it("returns 100 when instances match canonical steps exactly", () => {
      const steps = [EventType.IssueCreated, EventType.MessageSent];
      const c = candidate({
        id: "c",
        steps,
        instances: [
          instance([EventType.IssueCreated, EventType.MessageSent]),
          instance([EventType.MessageSent, EventType.IssueCreated]),
        ],
      });

      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.consistency).toBe(100);
    });

    it("returns lower score when instances diverge from canonical steps", () => {
      const steps = [EventType.IssueCreated, EventType.MessageSent];
      const c = candidate({
        id: "d",
        steps,
        instances: [
          // has an extra event type not in canonical
          instance([
            EventType.IssueCreated,
            EventType.MessageSent,
            EventType.MeetingHeld,
          ]),
        ],
      });

      const results = scorer.scoreAll([c]);
      // Jaccard: intersection=2, union=3 → 66.7 → rounds to 67
      expect(results[0].breakdown.consistency).toBe(67);
    });

    it("returns 0 for zero instances", () => {
      const c = candidate({ id: "e", instances: [] });
      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.consistency).toBe(0);
    });
  });

  describe("completion rate scoring", () => {
    it("returns 100 when all instances are completed", () => {
      const c = candidate({
        id: "f",
        instances: [
          instance([EventType.IssueCreated], true),
          instance([EventType.IssueCreated], true),
        ],
      });

      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.completionRate).toBe(100);
    });

    it("returns 50 when half are completed", () => {
      const c = candidate({
        id: "g",
        instances: [
          instance([EventType.IssueCreated], true),
          instance([EventType.IssueCreated], false),
        ],
      });

      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.completionRate).toBe(50);
    });

    it("returns 0 when none are completed", () => {
      const c = candidate({
        id: "h",
        instances: [
          instance([EventType.IssueCreated], false),
          instance([EventType.IssueCreated], false),
        ],
      });

      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.completionRate).toBe(0);
    });

    it("returns 0 for zero instances", () => {
      const c = candidate({ id: "i", instances: [] });
      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.completionRate).toBe(0);
    });
  });

  describe("automation potential scoring", () => {
    it("returns 100 when all steps are mechanical", () => {
      const c = candidate({
        id: "j",
        steps: [
          EventType.MessageSent,
          EventType.IssueCreated,
          EventType.FollowupAssigned,
        ],
        instances: [instance([EventType.MessageSent])],
      });

      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.automationPotential).toBe(100);
    });

    it("returns 0 when all steps are decision steps", () => {
      const c = candidate({
        id: "k",
        steps: [EventType.DecisionMade, EventType.MeetingHeld],
        instances: [instance([EventType.DecisionMade])],
      });

      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.automationPotential).toBe(0);
    });

    it("returns proportional score for mixed steps", () => {
      const c = candidate({
        id: "l",
        steps: [
          EventType.IssueCreated, // mechanical
          EventType.DecisionMade, // decision
          EventType.MessageSent, // mechanical
        ],
        instances: [instance([EventType.IssueCreated])],
      });

      const results = scorer.scoreAll([c]);
      // 2/3 = 66.7 → rounds to 67
      expect(results[0].breakdown.automationPotential).toBe(67);
    });

    it("returns 0 for empty steps", () => {
      const c = candidate({ id: "m", steps: [], instances: [] });
      const results = scorer.scoreAll([c]);
      expect(results[0].breakdown.automationPotential).toBe(0);
    });
  });

  describe("composite scoring", () => {
    it("produces a score between 0 and 100", () => {
      const c = candidate({
        id: "n",
        steps: [EventType.IssueCreated, EventType.MessageSent],
        instances: [
          instance(
            [EventType.IssueCreated, EventType.MessageSent],
            true,
          ),
        ],
      });

      const results = scorer.scoreAll([c]);
      expect(results[0].compositeScore).toBeGreaterThanOrEqual(0);
      expect(results[0].compositeScore).toBeLessThanOrEqual(100);
    });

    it("respects custom weights", () => {
      const weightedScorer = new PatternScorer({
        frequency: 1.0,
        consistency: 0,
        completionRate: 0,
        automationPotential: 0,
      });

      const c = candidate({
        id: "o",
        instances: [instance([EventType.IssueCreated], true)],
      });

      // Use scoreAll with two candidates to get frequency = 50 (1/2)
      const dummy = candidate({
        id: "dummy",
        instances: [
          instance([EventType.IssueCreated], true),
          instance([EventType.IssueCreated], true),
        ],
      });
      const results = weightedScorer.scoreAll([c, dummy]);
      const result = results.find((r) => r.patternId === "o")!;
      // frequency = 50 (1/2), all other weights 0
      expect(result.compositeScore).toBe(50);
    });

    it("rejects weights that do not sum to 1", () => {
      expect(() => new PatternScorer({
        frequency: 0.5,
        consistency: 0.5,
        completionRate: 0.5,
        automationPotential: 0.5,
      })).toThrow("weights must sum to 1");
    });
  });

  describe("scoreAll ranking", () => {
    it("returns patterns sorted by composite score descending", () => {
      const candidates = [
        candidate({
          id: "low",
          name: "Low",
          steps: [EventType.DecisionMade, EventType.MeetingHeld],
          instances: [
            instance([EventType.DecisionMade], false),
          ],
        }),
        candidate({
          id: "high",
          name: "High",
          steps: [EventType.MessageSent, EventType.IssueCreated],
          instances: [
            instance(
              [EventType.MessageSent, EventType.IssueCreated],
              true,
            ),
            instance(
              [EventType.MessageSent, EventType.IssueCreated],
              true,
            ),
            instance(
              [EventType.MessageSent, EventType.IssueCreated],
              true,
            ),
          ],
        }),
      ];

      const results = scorer.scoreAll(candidates);
      expect(results[0].patternId).toBe("high");
      expect(results[1].patternId).toBe("low");
      expect(results[0].compositeScore).toBeGreaterThan(
        results[1].compositeScore,
      );
    });

    it("returns empty array for empty input", () => {
      expect(scorer.scoreAll([])).toEqual([]);
    });
  });
});
