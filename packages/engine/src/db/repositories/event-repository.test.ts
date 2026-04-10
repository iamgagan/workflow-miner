import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseClient } from "../client";
import { EventRepository, type InsertEvent } from "./event-repository";

function makeEvent(overrides: Partial<InsertEvent> = {}): InsertEvent {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2, 10)}`,
    source_system: "slack",
    source_object_type: "message",
    source_object_id: "msg-123",
    actor_id: "user-1",
    timestamp: "2026-01-15T10:00:00Z",
    event_type: "message.sent",
    ...overrides,
  };
}

describe("db/event-repository", () => {
  let client: DatabaseClient;
  let repo: EventRepository;

  beforeEach(() => {
    client = new DatabaseClient({ inMemory: true });
    client.runMigrations();
    repo = new EventRepository(client.raw);
  });

  afterEach(() => {
    client.close();
  });

  it("inserts and retrieves a single event", () => {
    const event = makeEvent({ event_id: "evt-1" });
    repo.insert(event);

    const found = repo.findById("evt-1");
    expect(found).toBeDefined();
    expect(found!.event_id).toBe("evt-1");
    expect(found!.source_system).toBe("slack");
    expect(found!.event_type).toBe("message.sent");
    expect(found!.confidence).toBe(1.0);
    expect(found!.pii_redaction_state).toBe("none");
  });

  it("returns undefined for non-existent event", () => {
    expect(repo.findById("nonexistent")).toBeUndefined();
  });

  it("inserts many events in a transaction", () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      makeEvent({ event_id: `evt-${i}`, timestamp: `2026-01-15T${String(i).padStart(2, "0")}:00:00Z` })
    );
    repo.insertMany(events);

    const results = repo.query({ limit: 100 });
    expect(results).toHaveLength(50);
  });

  it("queries by source_system", () => {
    repo.insert(makeEvent({ event_id: "e1", source_system: "slack" }));
    repo.insert(makeEvent({ event_id: "e2", source_system: "gmail" }));
    repo.insert(makeEvent({ event_id: "e3", source_system: "slack" }));

    const results = repo.query({ source_system: "slack" });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.source_system === "slack")).toBe(true);
  });

  it("queries by actor_id", () => {
    repo.insert(makeEvent({ event_id: "e1", actor_id: "alice" }));
    repo.insert(makeEvent({ event_id: "e2", actor_id: "bob" }));

    const results = repo.query({ actor_id: "alice" });
    expect(results).toHaveLength(1);
    expect(results[0].actor_id).toBe("alice");
  });

  it("queries by time range", () => {
    repo.insert(makeEvent({ event_id: "e1", timestamp: "2026-01-10T10:00:00Z" }));
    repo.insert(makeEvent({ event_id: "e2", timestamp: "2026-01-15T10:00:00Z" }));
    repo.insert(makeEvent({ event_id: "e3", timestamp: "2026-01-20T10:00:00Z" }));

    const results = repo.query({
      after: "2026-01-12T00:00:00Z",
      before: "2026-01-18T00:00:00Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0].event_id).toBe("e2");
  });

  it("supports pagination with limit and offset", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ event_id: `evt-${i}`, timestamp: `2026-01-15T${String(i).padStart(2, "0")}:00:00Z` })
    );
    repo.insertMany(events);

    const page1 = repo.query({ limit: 3, offset: 0 });
    const page2 = repo.query({ limit: 3, offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0].event_id).not.toBe(page2[0].event_id);
  });

  it("counts events by source", () => {
    repo.insert(makeEvent({ event_id: "e1", source_system: "slack" }));
    repo.insert(makeEvent({ event_id: "e2", source_system: "slack" }));
    repo.insert(makeEvent({ event_id: "e3", source_system: "gmail" }));

    const counts = repo.countBySource();
    expect(counts.slack).toBe(2);
    expect(counts.gmail).toBe(1);
  });

  it("inserts 1000 events in under 1 second", () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      makeEvent({
        event_id: `perf-${i}`,
        timestamp: `2026-01-15T00:00:${String(i % 60).padStart(2, "0")}Z`,
      })
    );

    const start = performance.now();
    repo.insertMany(events);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    const results = repo.query({ limit: 1001 });
    expect(results).toHaveLength(1000);
  });

  it("stores and retrieves JSON fields correctly", () => {
    const entityRefs = JSON.stringify([{ id: "e1", type: "person" }]);
    const metadata = JSON.stringify({ priority: "high" });
    const causalLinks = JSON.stringify(["evt-0"]);

    repo.insert(
      makeEvent({
        event_id: "json-test",
        entity_refs: entityRefs,
        metadata,
        causal_links: causalLinks,
      })
    );

    const found = repo.findById("json-test")!;
    expect(JSON.parse(found.entity_refs)).toEqual([{ id: "e1", type: "person" }]);
    expect(JSON.parse(found.metadata)).toEqual({ priority: "high" });
    expect(JSON.parse(found.causal_links)).toEqual(["evt-0"]);
  });
});
