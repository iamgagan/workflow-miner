import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseClient } from "../client";
import { PatternRepository, type InsertPattern } from "./pattern-repository";

function makePattern(overrides: Partial<InsertPattern> = {}): InsertPattern {
  return {
    pattern_id: `pat-${Math.random().toString(36).slice(2, 10)}`,
    name: "Test Pattern",
    frequency: 5,
    confidence: 0.85,
    ...overrides,
  };
}

describe("db/pattern-repository", () => {
  let client: DatabaseClient;
  let repo: PatternRepository;

  beforeEach(() => {
    client = new DatabaseClient({ inMemory: true });
    client.runMigrations();
    repo = new PatternRepository(client.raw);
  });

  afterEach(() => {
    client.close();
  });

  it("inserts and retrieves a pattern", () => {
    repo.insert(makePattern({ pattern_id: "pat-1", name: "Daily standup flow" }));

    const found = repo.findById("pat-1");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Daily standup flow");
    expect(found!.frequency).toBe(5);
    expect(found!.confidence).toBe(0.85);
  });

  it("returns undefined for non-existent pattern", () => {
    expect(repo.findById("nonexistent")).toBeUndefined();
  });

  it("inserts pattern with events", () => {
    repo.insert(
      makePattern({
        pattern_id: "pat-2",
        events: [
          { event_type: "issue.created", position: 0, source_system: "linear" },
          { event_type: "message.sent", position: 1, source_system: "slack" },
          { event_type: "issue.updated", position: 2, source_system: "linear" },
        ],
      })
    );

    const events = repo.findEvents("pat-2");
    expect(events).toHaveLength(3);
    expect(events[0].event_type).toBe("issue.created");
    expect(events[0].position).toBe(0);
    expect(events[1].event_type).toBe("message.sent");
    expect(events[2].position).toBe(2);
  });

  it("queries patterns by minimum frequency", () => {
    repo.insert(makePattern({ pattern_id: "p1", frequency: 10 }));
    repo.insert(makePattern({ pattern_id: "p2", frequency: 3 }));
    repo.insert(makePattern({ pattern_id: "p3", frequency: 7 }));

    const results = repo.query({ min_frequency: 5 });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.frequency >= 5)).toBe(true);
  });

  it("queries patterns by minimum confidence", () => {
    repo.insert(makePattern({ pattern_id: "p1", confidence: 0.9 }));
    repo.insert(makePattern({ pattern_id: "p2", confidence: 0.3 }));
    repo.insert(makePattern({ pattern_id: "p3", confidence: 0.7 }));

    const results = repo.query({ min_confidence: 0.6 });
    expect(results).toHaveLength(2);
  });

  it("orders results by frequency descending by default", () => {
    repo.insert(makePattern({ pattern_id: "p1", frequency: 3 }));
    repo.insert(makePattern({ pattern_id: "p2", frequency: 10 }));
    repo.insert(makePattern({ pattern_id: "p3", frequency: 7 }));

    const results = repo.query();
    expect(results[0].frequency).toBe(10);
    expect(results[1].frequency).toBe(7);
    expect(results[2].frequency).toBe(3);
  });

  it("updates frequency and confidence", () => {
    repo.insert(makePattern({ pattern_id: "pat-u", frequency: 1, confidence: 0.5 }));

    repo.updateFrequency("pat-u", 15, 0.95);

    const found = repo.findById("pat-u")!;
    expect(found.frequency).toBe(15);
    expect(found.confidence).toBe(0.95);
  });

  it("rejects invalid order_by values (SQL injection guard)", () => {
    repo.insert(makePattern({ pattern_id: "p1", frequency: 10 }));

    expect(() =>
      repo.query({ order_by: "frequency; DROP TABLE patterns--" as any })
    ).toThrow("Invalid order_by column");
  });

  it("accepts valid order_by values", () => {
    repo.insert(makePattern({ pattern_id: "p1", frequency: 10 }));

    expect(() => repo.query({ order_by: "frequency" })).not.toThrow();
    expect(() => repo.query({ order_by: "confidence" })).not.toThrow();
    expect(() => repo.query({ order_by: "created_at" })).not.toThrow();
  });

  it("cascades delete from pattern to pattern_events", () => {
    repo.insert(
      makePattern({
        pattern_id: "pat-del",
        events: [
          { event_type: "a", position: 0 },
          { event_type: "b", position: 1 },
        ],
      })
    );

    // Verify events exist
    expect(repo.findEvents("pat-del")).toHaveLength(2);

    // Delete the pattern
    client.raw.prepare("DELETE FROM patterns WHERE pattern_id = ?").run("pat-del");

    // Events should be cascade-deleted
    expect(repo.findEvents("pat-del")).toHaveLength(0);
  });
});
