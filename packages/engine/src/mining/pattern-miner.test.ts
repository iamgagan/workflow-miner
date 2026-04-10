import { describe, it, expect } from "vitest";
import { PatternMiner } from "./pattern-miner.js";
import type { SessionSequence, SessionEvent } from "./types.js";

/** Helper to create a session event at a given minute offset. */
function evt(
  eventType: string,
  minuteOffset: number,
  source = "slack",
  actor = "user-1"
): SessionEvent {
  const ts = new Date(
    Date.UTC(2026, 0, 15, 9, minuteOffset, 0)
  ).toISOString();
  return { eventType, timestamp: ts, sourceSystem: source, actorId: actor };
}

/** Helper to create a session with ordered events. */
function session(id: string, events: SessionEvent[]): SessionSequence {
  return { sessionId: id, events };
}

describe("mining/pattern-miner", () => {
  describe("simple sequence detection", () => {
    it("finds a pattern repeated across sessions", () => {
      // The sequence decision_made → issue_created → followup_assigned
      // appears in 3 sessions
      const sessions: SessionSequence[] = [
        session("s1", [
          evt("decision_made", 0),
          evt("issue_created", 5),
          evt("followup_assigned", 10),
        ]),
        session("s2", [
          evt("decision_made", 0),
          evt("issue_created", 3),
          evt("followup_assigned", 8),
        ]),
        session("s3", [
          evt("decision_made", 0),
          evt("issue_created", 7),
          evt("followup_assigned", 15),
        ]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      expect(patterns.length).toBeGreaterThanOrEqual(1);

      // The full 3-step pattern should be found
      const fullPattern = patterns.find((p) => p.steps.length === 3);
      expect(fullPattern).toBeDefined();
      expect(fullPattern!.steps.map((s) => s.eventType)).toEqual([
        "decision_made",
        "issue_created",
        "followup_assigned",
      ]);
      expect(fullPattern!.support).toBe(3);
      expect(fullPattern!.confidence).toBe(1); // all sessions
    });

    it("computes average duration across sessions", () => {
      const sessions: SessionSequence[] = [
        session("s1", [
          evt("decision_made", 0),
          evt("issue_created", 10), // 10 min gap
        ]),
        session("s2", [
          evt("decision_made", 0),
          evt("issue_created", 20), // 20 min gap
        ]),
        session("s3", [
          evt("decision_made", 0),
          evt("issue_created", 30), // 30 min gap
        ]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      const pattern = patterns.find((p) => p.steps.length === 2);
      expect(pattern).toBeDefined();
      // Average: (10 + 20 + 30) / 3 = 20 minutes = 1_200_000 ms
      expect(pattern!.avgDurationMs).toBe(1_200_000);
    });
  });

  describe("branching paths", () => {
    it("detects patterns even when sessions have extra events", () => {
      // Core pattern: decision_made → issue_created appears in all 3,
      // but each session has different surrounding events
      const sessions: SessionSequence[] = [
        session("s1", [
          evt("message_received", 0),
          evt("decision_made", 5),
          evt("issue_created", 10),
          evt("artifact_shared", 15),
        ]),
        session("s2", [
          evt("decision_made", 0),
          evt("meeting_held", 3),
          evt("issue_created", 8),
        ]),
        session("s3", [
          evt("message_sent", 0),
          evt("decision_made", 2),
          evt("issue_created", 7),
          evt("followup_assigned", 12),
        ]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      // decision_made → issue_created should appear with support 3
      const core = patterns.find(
        (p) =>
          p.steps.length >= 2 &&
          p.steps[0].eventType === "decision_made" &&
          p.steps[1].eventType === "issue_created"
      );
      expect(core).toBeDefined();
      expect(core!.support).toBe(3);
    });

    it("finds multiple distinct patterns in the same data", () => {
      const sessions: SessionSequence[] = [
        session("s1", [
          evt("decision_made", 0),
          evt("issue_created", 5),
          evt("message_sent", 10),
          evt("followup_assigned", 15),
        ]),
        session("s2", [
          evt("decision_made", 0),
          evt("issue_created", 5),
          evt("message_sent", 8),
          evt("followup_assigned", 12),
        ]),
        session("s3", [
          evt("decision_made", 0),
          evt("issue_created", 5),
          evt("message_sent", 9),
          evt("followup_assigned", 14),
        ]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      // Should find the longest pattern (all 4 steps) with support 3
      const longest = patterns.find((p) => p.steps.length === 4);
      expect(longest).toBeDefined();
      expect(longest!.support).toBe(3);
    });
  });

  describe("no-pattern case", () => {
    it("returns empty when no pattern meets min support", () => {
      const sessions: SessionSequence[] = [
        session("s1", [evt("decision_made", 0), evt("issue_created", 5)]),
        session("s2", [evt("message_sent", 0), evt("artifact_shared", 5)]),
        session("s3", [evt("meeting_held", 0), evt("followup_assigned", 5)]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      // No 2-step subsequence appears in all 3 sessions
      expect(patterns).toHaveLength(0);
    });

    it("returns empty for no sessions", () => {
      const miner = new PatternMiner();
      expect(miner.mine([])).toHaveLength(0);
    });

    it("returns empty for single-event sessions", () => {
      const sessions: SessionSequence[] = [
        session("s1", [evt("decision_made", 0)]),
        session("s2", [evt("decision_made", 0)]),
        session("s3", [evt("decision_made", 0)]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      // Single-event patterns are excluded (need length >= 2)
      expect(patterns).toHaveLength(0);
    });
  });

  describe("configuration", () => {
    it("respects custom minSupport threshold", () => {
      const sessions: SessionSequence[] = [
        session("s1", [evt("decision_made", 0), evt("issue_created", 5)]),
        session("s2", [evt("decision_made", 0), evt("issue_created", 5)]),
        session("s3", [evt("message_sent", 0), evt("artifact_shared", 5)]),
      ];

      // With minSupport 2, decision_made → issue_created should be found
      const miner2 = new PatternMiner({ minSupport: 2 });
      const patterns2 = miner2.mine(sessions);
      expect(patterns2.length).toBeGreaterThanOrEqual(1);
      expect(patterns2[0].support).toBe(2);

      // With minSupport 3, nothing should be found
      const miner3 = new PatternMiner({ minSupport: 3 });
      const patterns3 = miner3.mine(sessions);
      expect(patterns3).toHaveLength(0);
    });

    it("respects maxPatternLength", () => {
      const sessions: SessionSequence[] = [
        session("s1", [
          evt("a", 0),
          evt("b", 5),
          evt("c", 10),
          evt("d", 15),
        ]),
        session("s2", [
          evt("a", 0),
          evt("b", 5),
          evt("c", 10),
          evt("d", 15),
        ]),
        session("s3", [
          evt("a", 0),
          evt("b", 5),
          evt("c", 10),
          evt("d", 15),
        ]),
      ];

      const miner = new PatternMiner({ minSupport: 3, maxPatternLength: 2 });
      const patterns = miner.mine(sessions);

      // No pattern should be longer than 2 steps
      for (const p of patterns) {
        expect(p.steps.length).toBeLessThanOrEqual(2);
      }
    });

    it("source-aware mode treats same event from different sources as distinct", () => {
      const sessions: SessionSequence[] = [
        session("s1", [
          evt("message_sent", 0, "slack"),
          evt("message_sent", 5, "gmail"),
        ]),
        session("s2", [
          evt("message_sent", 0, "slack"),
          evt("message_sent", 5, "gmail"),
        ]),
        session("s3", [
          evt("message_sent", 0, "slack"),
          evt("message_sent", 5, "gmail"),
        ]),
      ];

      const miner = new PatternMiner({ minSupport: 3, sourceAware: true });
      const patterns = miner.mine(sessions);

      // Should find: message_sent@slack → message_sent@gmail
      const pattern = patterns.find((p) => p.steps.length === 2);
      expect(pattern).toBeDefined();
      expect(pattern!.steps[0].sourceSystem).toBe("slack");
      expect(pattern!.steps[1].sourceSystem).toBe("gmail");
    });
  });

  describe("pattern metadata", () => {
    it("provides example session IDs", () => {
      const sessions: SessionSequence[] = [
        session("s1", [evt("a", 0), evt("b", 5)]),
        session("s2", [evt("a", 0), evt("b", 5)]),
        session("s3", [evt("a", 0), evt("b", 5)]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      expect(patterns[0].exampleSessions).toEqual(
        expect.arrayContaining(["s1", "s2", "s3"])
      );
    });

    it("generates a human-readable name from step event types", () => {
      const sessions: SessionSequence[] = [
        session("s1", [evt("decision_made", 0), evt("issue_created", 5)]),
        session("s2", [evt("decision_made", 0), evt("issue_created", 5)]),
        session("s3", [evt("decision_made", 0), evt("issue_created", 5)]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      expect(patterns[0].name).toBe("decision_made → issue_created");
    });

    it("assigns content-hash pattern IDs that are stable across runs", () => {
      const sessions: SessionSequence[] = [
        session("s1", [
          evt("a", 0),
          evt("b", 5),
          evt("c", 10),
        ]),
        session("s2", [
          evt("a", 0),
          evt("b", 5),
          evt("c", 10),
        ]),
        session("s3", [
          evt("a", 0),
          evt("b", 5),
          evt("c", 10),
        ]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns1 = miner.mine(sessions);
      const patterns2 = miner.mine(sessions);

      for (const p of patterns1) {
        expect(p.id).toMatch(/^pattern-[0-9a-f]{12}$/);
      }
      // IDs are stable across runs
      expect(patterns1.map((p) => p.id)).toEqual(patterns2.map((p) => p.id));
    });

    it("rejects minSupport < 2", () => {
      expect(() => new PatternMiner({ minSupport: 1 })).toThrow(
        "minSupport must be >= 2"
      );
    });
  });

  describe("closed pattern pruning", () => {
    it("prunes shorter subsequences when a longer one has the same support", () => {
      const sessions: SessionSequence[] = [
        session("s1", [evt("a", 0), evt("b", 5), evt("c", 10)]),
        session("s2", [evt("a", 0), evt("b", 5), evt("c", 10)]),
        session("s3", [evt("a", 0), evt("b", 5), evt("c", 10)]),
      ];

      const miner = new PatternMiner({ minSupport: 3 });
      const patterns = miner.mine(sessions);

      // Since a→b→c has support 3, and a→b also has support 3,
      // a→b should be pruned (subsumed by a→b→c with same support)
      const twoSteps = patterns.filter((p) => p.steps.length === 2);
      const threeSteps = patterns.filter((p) => p.steps.length === 3);

      expect(threeSteps.length).toBe(1);
      // 2-step subsequences (a→b, a→c, b→c) should all be pruned
      // since they are subsequences of a→b→c with the same support
      expect(twoSteps.length).toBe(0);
    });
  });
});
