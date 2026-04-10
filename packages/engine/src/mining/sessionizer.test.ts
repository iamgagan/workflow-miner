import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Sessionizer } from "./sessionizer.js";
import type { EventRow } from "../db/repositories/event-repository.js";
import { DatabaseClient } from "../db/client.js";
import { SessionRepository } from "../db/repositories/session-repository.js";

let nextId = 0;

function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
  nextId++;
  return {
    event_id: `evt-${nextId}`,
    source_system: "slack",
    source_object_type: "message",
    source_object_id: `obj-${nextId}`,
    actor_id: "user-1",
    timestamp: "2026-01-15T09:00:00Z",
    workspace_id: null,
    conversation_id: null,
    entity_refs: "[]",
    event_type: "message_sent",
    content_text: null,
    metadata: "{}",
    parent_event_id: null,
    causal_links: "[]",
    confidence: 1.0,
    pii_redaction_state: "none",
    created_at: "2026-01-15T09:00:00Z",
    ...overrides,
  };
}

describe("mining/sessionizer", () => {
  beforeEach(() => {
    nextId = 0;
  });

  describe("basic grouping", () => {
    it("groups nearby events into a single session", () => {
      const sessionizer = new Sessionizer({ gapThresholdMinutes: 30 });
      const events = [
        makeEvent({ timestamp: "2026-01-15T09:00:00Z" }),
        makeEvent({ timestamp: "2026-01-15T09:10:00Z" }),
        makeEvent({ timestamp: "2026-01-15T09:20:00Z" }),
      ];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].eventIds).toHaveLength(3);
      expect(sessions[0].startTime).toBe("2026-01-15T09:00:00Z");
      expect(sessions[0].endTime).toBe("2026-01-15T09:20:00Z");
      expect(sessions[0].actorId).toBe("user-1");
    });

    it("splits events into separate sessions when gap exceeds threshold", () => {
      const sessionizer = new Sessionizer({ gapThresholdMinutes: 30 });
      const events = [
        makeEvent({ timestamp: "2026-01-15T09:00:00Z" }),
        makeEvent({ timestamp: "2026-01-15T09:10:00Z" }),
        // 2 hour gap
        makeEvent({ timestamp: "2026-01-15T11:10:00Z" }),
        makeEvent({ timestamp: "2026-01-15T11:20:00Z" }),
      ];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].eventIds).toHaveLength(2);
      expect(sessions[1].eventIds).toHaveLength(2);
      expect(sessions[0].endTime).toBe("2026-01-15T09:10:00Z");
      expect(sessions[1].startTime).toBe("2026-01-15T11:10:00Z");
    });

    it("returns empty array for empty input", () => {
      const sessionizer = new Sessionizer();
      expect(sessionizer.groupEvents([])).toEqual([]);
    });
  });

  describe("single event", () => {
    it("creates a session for a single event", () => {
      const sessionizer = new Sessionizer();
      const events = [makeEvent({ timestamp: "2026-01-15T09:00:00Z" })];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].eventIds).toHaveLength(1);
      expect(sessions[0].startTime).toBe(sessions[0].endTime);
    });
  });

  describe("configurable gap threshold", () => {
    it("uses custom gap threshold", () => {
      const sessionizer = new Sessionizer({ gapThresholdMinutes: 5 });
      const events = [
        makeEvent({ timestamp: "2026-01-15T09:00:00Z" }),
        // 10 minute gap — exceeds 5 min threshold
        makeEvent({ timestamp: "2026-01-15T09:10:00Z" }),
      ];

      const sessions = sessionizer.groupEvents(events);
      expect(sessions).toHaveLength(2);
    });

    it("defaults to 30 minutes", () => {
      const sessionizer = new Sessionizer();
      const events = [
        makeEvent({ timestamp: "2026-01-15T09:00:00Z" }),
        // 25 minute gap — within 30 min default
        makeEvent({ timestamp: "2026-01-15T09:25:00Z" }),
      ];

      const sessions = sessionizer.groupEvents(events);
      expect(sessions).toHaveLength(1);
    });
  });

  describe("cross-source sessions", () => {
    it("groups events from different sources in same session by conversation", () => {
      const sessionizer = new Sessionizer({ gapThresholdMinutes: 30 });
      const events = [
        makeEvent({
          timestamp: "2026-01-15T09:00:00Z",
          source_system: "slack",
          conversation_id: "thread-1",
        }),
        makeEvent({
          timestamp: "2026-01-15T09:05:00Z",
          source_system: "linear",
          conversation_id: "thread-1",
        }),
        makeEvent({
          timestamp: "2026-01-15T09:10:00Z",
          source_system: "gmail",
        }),
      ];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sourceSystems).toContain("slack");
      expect(sessions[0].sourceSystems).toContain("linear");
      expect(sessions[0].sourceSystems).toContain("gmail");
    });

    it("merges temporally separate clusters sharing a conversation thread", () => {
      const sessionizer = new Sessionizer({ gapThresholdMinutes: 10 });
      const events = [
        makeEvent({
          timestamp: "2026-01-15T09:00:00Z",
          source_system: "slack",
          conversation_id: "thread-abc",
        }),
        // 20 min gap (exceeds 10 min threshold) but same conversation
        makeEvent({
          timestamp: "2026-01-15T09:20:00Z",
          source_system: "linear",
          conversation_id: "thread-abc",
        }),
      ];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].eventIds).toHaveLength(2);
      expect(sessions[0].sourceSystems).toContain("slack");
      expect(sessions[0].sourceSystems).toContain("linear");
    });
  });

  describe("multiple actors", () => {
    it("creates separate sessions per actor", () => {
      const sessionizer = new Sessionizer();
      const events = [
        makeEvent({ actor_id: "alice", timestamp: "2026-01-15T09:00:00Z" }),
        makeEvent({ actor_id: "bob", timestamp: "2026-01-15T09:05:00Z" }),
        makeEvent({ actor_id: "alice", timestamp: "2026-01-15T09:10:00Z" }),
      ];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions).toHaveLength(2);
      const aliceSession = sessions.find((s) => s.actorId === "alice")!;
      const bobSession = sessions.find((s) => s.actorId === "bob")!;
      expect(aliceSession.eventIds).toHaveLength(2);
      expect(bobSession.eventIds).toHaveLength(1);
    });
  });

  describe("long gaps", () => {
    it("creates many sessions from events spread across days", () => {
      const sessionizer = new Sessionizer({ gapThresholdMinutes: 30 });
      const events = [
        makeEvent({ timestamp: "2026-01-15T09:00:00Z" }),
        makeEvent({ timestamp: "2026-01-15T09:10:00Z" }),
        makeEvent({ timestamp: "2026-01-16T09:00:00Z" }),
        makeEvent({ timestamp: "2026-01-16T09:10:00Z" }),
        makeEvent({ timestamp: "2026-01-17T14:00:00Z" }),
      ];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions).toHaveLength(3);
      expect(sessions[0].eventIds).toHaveLength(2);
      expect(sessions[1].eventIds).toHaveLength(2);
      expect(sessions[2].eventIds).toHaveLength(1);
    });
  });

  describe("metadata", () => {
    it("computes dominant topic from event types", () => {
      const sessionizer = new Sessionizer();
      const events = [
        makeEvent({ timestamp: "2026-01-15T09:00:00Z", event_type: "message_sent" }),
        makeEvent({ timestamp: "2026-01-15T09:05:00Z", event_type: "message_sent" }),
        makeEvent({ timestamp: "2026-01-15T09:10:00Z", event_type: "issue_created" }),
      ];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions[0].metadata.dominantTopic).toBe("message_sent");
    });

    it("collects conversation ids in metadata", () => {
      const sessionizer = new Sessionizer();
      const events = [
        makeEvent({ timestamp: "2026-01-15T09:00:00Z", conversation_id: "conv-1" }),
        makeEvent({ timestamp: "2026-01-15T09:05:00Z", conversation_id: "conv-2" }),
        makeEvent({ timestamp: "2026-01-15T09:10:00Z", conversation_id: null }),
      ];

      const sessions = sessionizer.groupEvents(events);

      expect(sessions[0].metadata.conversationIds).toContain("conv-1");
      expect(sessions[0].metadata.conversationIds).toContain("conv-2");
      expect(sessions[0].metadata.conversationIds).toHaveLength(2);
    });
  });

  describe("groupAndStore", () => {
    let client: DatabaseClient;
    let repo: SessionRepository;

    beforeEach(() => {
      client = new DatabaseClient({ inMemory: true });
      client.runMigrations();
      repo = new SessionRepository(client.raw);
    });

    afterEach(() => {
      client.close();
    });

    it("persists sessions to the repository", () => {
      const sessionizer = new Sessionizer();
      const events = [
        makeEvent({ timestamp: "2026-01-15T09:00:00Z", actor_id: "alice" }),
        makeEvent({ timestamp: "2026-01-15T09:10:00Z", actor_id: "alice" }),
        makeEvent({ timestamp: "2026-01-15T14:00:00Z", actor_id: "alice" }),
      ];

      const sessions = sessionizer.groupAndStore(events, repo);

      expect(sessions).toHaveLength(2);

      const stored = repo.query({ actor_id: "alice" });
      expect(stored).toHaveLength(2);
      expect(stored[0].event_count).toBe(2);
      expect(stored[1].event_count).toBe(1);
    });

    it("stores source systems and metadata as JSON", () => {
      const sessionizer = new Sessionizer();
      const events = [
        makeEvent({
          timestamp: "2026-01-15T09:00:00Z",
          source_system: "slack",
          conversation_id: "conv-x",
        }),
        makeEvent({
          timestamp: "2026-01-15T09:05:00Z",
          source_system: "linear",
        }),
      ];

      const sessions = sessionizer.groupAndStore(events, repo);
      const stored = repo.findById(sessions[0].sessionId)!;

      expect(JSON.parse(stored.source_systems)).toContain("slack");
      expect(JSON.parse(stored.source_systems)).toContain("linear");
      const meta = JSON.parse(stored.metadata);
      expect(meta.conversationIds).toContain("conv-x");
    });
  });
});
