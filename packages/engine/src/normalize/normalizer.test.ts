import { describe, it, expect } from "vitest";
import { Normalizer } from "./normalizer.js";
import { EventType, EntityType } from "./schema.js";
import { EntityResolver } from "./entity-resolver.js";
import type { RawEvent } from "../connectors/types.js";

function makeRawEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: "raw-1",
    source: "slack",
    type: "message_sent",
    timestamp: "2026-01-15T10:00:00Z",
    participants: [
      { id: "u1", name: "Alice", type: "person" },
    ],
    data: { text: "hello" },
    ...overrides,
  };
}

describe("Normalizer", () => {
  const normalizer = new Normalizer();

  describe("normalize", () => {
    it("returns empty arrays for empty input", () => {
      const result = normalizer.normalize([]);
      expect(result.events).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it("normalizes a single raw event", () => {
      const raw = makeRawEvent();
      const { events, errors } = normalizer.normalize([raw]);

      expect(errors).toEqual([]);
      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event.type).toBe(EventType.MessageSent);
      expect(event.source).toBe("slack");
      expect(event.timestamp).toEqual(new Date("2026-01-15T10:00:00Z"));
      expect(event.rawEventId).toBe("raw-1");
      expect(event.metadata).toEqual({ text: "hello" });
      expect(event.id).toBeDefined();
    });

    it("normalizes multiple events", () => {
      const events = [
        makeRawEvent({ id: "r1" }),
        makeRawEvent({ id: "r2", type: "issue_created" }),
      ];
      const { events: result } = normalizer.normalize(events);
      expect(result).toHaveLength(2);
      expect(result[0].rawEventId).toBe("r1");
      expect(result[1].rawEventId).toBe("r2");
    });

    it("generates deterministic IDs (same input → same ID)", () => {
      const raw = makeRawEvent({ id: "deterministic-test" });
      const { events: result1 } = normalizer.normalize([raw]);
      const { events: result2 } = new Normalizer().normalize([raw]);
      expect(result1[0].id).toBe(result2[0].id);
    });

    it("assigns different IDs to different events", () => {
      const events = [makeRawEvent({ id: "r1" }), makeRawEvent({ id: "r2" })];
      const { events: result } = normalizer.normalize(events);
      expect(result[0].id).not.toBe(result[1].id);
    });
  });

  describe("event type mapping", () => {
    const eventTypes: Array<[string, EventType]> = [
      ["message_sent", EventType.MessageSent],
      ["message_received", EventType.MessageReceived],
      ["decision_made", EventType.DecisionMade],
      ["issue_created", EventType.IssueCreated],
      ["issue_updated", EventType.IssueUpdated],
      ["meeting_scheduled", EventType.MeetingScheduled],
      ["meeting_held", EventType.MeetingHeld],
      ["meeting_cancelled", EventType.MeetingCancelled],
      ["followup_assigned", EventType.FollowupAssigned],
      ["artifact_shared", EventType.ArtifactShared],
    ];

    it.each(eventTypes)("maps %s to %s", (rawType, expected) => {
      const raw = makeRawEvent({ type: rawType });
      const { events: [event] } = normalizer.normalize([raw]);
      expect(event.type).toBe(expected);
    });

    it("collects unknown event type as error instead of throwing", () => {
      const raw = makeRawEvent({ type: "unknown_type" });
      const { events, errors } = normalizer.normalize([raw]);
      expect(events).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].rawEventId).toBe("raw-1");
      expect(errors[0].message).toContain("Unknown event type");
    });
  });

  describe("entity mapping", () => {
    const entityTypes: Array<[string, EntityType]> = [
      ["person", EntityType.Person],
      ["thread", EntityType.Thread],
      ["channel", EntityType.Channel],
      ["issue", EntityType.Issue],
      ["meeting", EntityType.Meeting],
      ["artifact", EntityType.Artifact],
      ["organizer", EntityType.Person],
      ["self", EntityType.Person],
      ["attendee", EntityType.Person],
    ];

    it.each(entityTypes)("maps participant type %s to %s", (rawType, expected) => {
      const fresh = new Normalizer();
      const raw = makeRawEvent({
        id: `entity-test-${rawType}`,
        participants: [{ id: `e1-${rawType}`, name: "Test", type: rawType }],
      });
      const { events: [event] } = fresh.normalize([raw]);
      expect(event.entities[0].type).toBe(expected);
    });

    it("collects unknown entity type as error instead of throwing", () => {
      const raw = makeRawEvent({
        participants: [{ id: "e1", name: "Test", type: "unknown_entity" }],
      });
      const { events, errors } = normalizer.normalize([raw]);
      expect(events).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("Unknown entity type");
    });

    it("maps entity name and source ID correctly", () => {
      const raw = makeRawEvent({
        source: "gmail",
        participants: [{ id: "p1", name: "Bob", type: "person" }],
      });
      const { events: [event] } = normalizer.normalize([raw]);
      expect(event.entities[0].name).toBe("Bob");
      expect(event.entities[0].sourceIds).toEqual({ gmail: "p1" });
    });

    it("handles multiple participants", () => {
      const raw = makeRawEvent({
        participants: [
          { id: "p1", name: "Alice", type: "person" },
          { id: "ch1", name: "#general", type: "channel" },
        ],
      });
      const { events: [event] } = normalizer.normalize([raw]);
      expect(event.entities).toHaveLength(2);
      expect(event.entities[0].type).toBe(EntityType.Person);
      expect(event.entities[1].type).toBe(EntityType.Channel);
    });

    it("handles event with no participants", () => {
      const raw = makeRawEvent({ participants: [] });
      const { events: [event] } = normalizer.normalize([raw]);
      expect(event.entities).toEqual([]);
    });
  });

  describe("timestamp handling", () => {
    it("parses ISO string timestamp", () => {
      const raw = makeRawEvent({ timestamp: "2026-03-01T14:30:00Z" });
      const { events: [event] } = normalizer.normalize([raw]);
      expect(event.timestamp).toEqual(new Date("2026-03-01T14:30:00Z"));
    });

    it("accepts Date object timestamp", () => {
      const date = new Date("2026-06-15T09:00:00Z");
      const raw = makeRawEvent({ timestamp: date as unknown as string });
      const { events: [event] } = normalizer.normalize([raw]);
      expect(event.timestamp).toEqual(date);
    });

    it("collects invalid timestamp as error instead of throwing", () => {
      const raw = makeRawEvent({ timestamp: "not-a-date" });
      const { events, errors } = normalizer.normalize([raw]);
      expect(events).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("Invalid timestamp");
    });
  });

  describe("metadata passthrough", () => {
    it("preserves raw data as metadata", () => {
      const raw = makeRawEvent({
        data: { subject: "Hello", labels: ["urgent"] },
      });
      const { events: [event] } = normalizer.normalize([raw]);
      expect(event.metadata).toEqual({ subject: "Hello", labels: ["urgent"] });
    });

    it("handles empty metadata", () => {
      const raw = makeRawEvent({ data: {} });
      const { events: [event] } = normalizer.normalize([raw]);
      expect(event.metadata).toEqual({});
    });
  });

  describe("partial results on mixed input", () => {
    it("returns good events and collects bad ones as errors", () => {
      const good = makeRawEvent({ id: "good-1" });
      const bad = makeRawEvent({ id: "bad-1", type: "nonexistent_type" });
      const good2 = makeRawEvent({ id: "good-2", type: "decision_made" });

      const { events, errors } = normalizer.normalize([good, bad, good2]);

      expect(events).toHaveLength(2);
      expect(events[0].rawEventId).toBe("good-1");
      expect(events[1].rawEventId).toBe("good-2");
      expect(errors).toHaveLength(1);
      expect(errors[0].rawEventId).toBe("bad-1");
    });
  });

  describe("EntityResolver integration", () => {
    it("deduplicates entities across events via shared resolver", () => {
      const resolver = new EntityResolver();
      const norm = new Normalizer(resolver);

      const event1 = makeRawEvent({
        id: "e1",
        source: "slack",
        participants: [{ id: "alice@co.com", name: "Alice", type: "person" }],
      });
      const event2 = makeRawEvent({
        id: "e2",
        source: "slack",
        participants: [{ id: "alice@co.com", name: "Alice S.", type: "person" }],
      });

      const { events } = norm.normalize([event1, event2]);

      // Both events should reference the same canonical entity ID
      expect(events[0].entities[0].id).toBe(events[1].entities[0].id);
      // Name should be updated to latest
      expect(events[1].entities[0].name).toBe("Alice S.");
    });

    it("generates deterministic entity IDs from source + sourceId", () => {
      const norm1 = new Normalizer();
      const norm2 = new Normalizer();

      const raw = makeRawEvent({
        source: "gmail",
        participants: [{ id: "bob@co.com", name: "Bob", type: "person" }],
      });

      const { events: r1 } = norm1.normalize([raw]);
      const { events: r2 } = norm2.normalize([raw]);

      expect(r1[0].entities[0].id).toBe(r2[0].entities[0].id);
    });
  });
});
