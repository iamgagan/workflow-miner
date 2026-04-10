import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseClient, resetDefaultClient } from "../db/client.js";
import { EventRepository, type InsertEvent } from "../db/repositories/event-repository.js";
import { PatternRepository } from "../db/repositories/pattern-repository.js";
import { runReportPipeline } from "./report.js";

let dbClient: DatabaseClient;

function getDb() {
  return dbClient.raw;
}

let nextId = 0;

function makeEvent(overrides: Partial<InsertEvent> = {}): InsertEvent {
  nextId++;
  return {
    event_id: `evt-${nextId}`,
    source_system: "slack",
    source_object_type: "message",
    source_object_id: `obj-${nextId}`,
    actor_id: "user-1",
    timestamp: "2026-01-15T09:00:00Z",
    event_type: "message_sent",
    ...overrides,
  };
}

/**
 * Insert a repeatable workflow session: issue_created → message_sent → followup_assigned.
 * Events are 5 minutes apart within the same actor, so they form one session.
 */
function insertWorkflowSession(
  repo: EventRepository,
  actorId: string,
  baseTime: string,
): void {
  const base = new Date(baseTime).getTime();
  repo.insertMany([
    makeEvent({
      actor_id: actorId,
      event_type: "issue_created",
      timestamp: new Date(base).toISOString(),
    }),
    makeEvent({
      actor_id: actorId,
      event_type: "message_sent",
      timestamp: new Date(base + 5 * 60_000).toISOString(),
    }),
    makeEvent({
      actor_id: actorId,
      event_type: "followup_assigned",
      timestamp: new Date(base + 10 * 60_000).toISOString(),
    }),
  ]);
}

describe("pipeline/report", () => {
  beforeEach(() => {
    nextId = 0;
    resetDefaultClient();
    dbClient = new DatabaseClient({ inMemory: true });
    dbClient.runMigrations();
  });

  afterEach(() => {
    dbClient.close();
  });

  it("returns empty result when database has no events", () => {
    const result = runReportPipeline(getDb());

    expect(result.patterns).toEqual([]);
    expect(result.totalEvents).toBe(0);
    expect(result.totalSessions).toBe(0);
    expect(result.totalMinedPatterns).toBe(0);
  });

  it("runs the full pipeline and discovers patterns from fixture events", () => {
    const repo = new EventRepository(getDb());

    // Create 3 sessions with the same workflow (minSupport=2 will detect it)
    // Each session is separated by >30 min gap so they become distinct sessions
    insertWorkflowSession(repo, "user-1", "2026-01-15T09:00:00Z");
    insertWorkflowSession(repo, "user-1", "2026-01-15T11:00:00Z");
    insertWorkflowSession(repo, "user-1", "2026-01-15T14:00:00Z");

    const result = runReportPipeline(getDb());

    expect(result.totalEvents).toBe(9);
    expect(result.totalSessions).toBe(3);
    expect(result.totalMinedPatterns).toBeGreaterThan(0);
    expect(result.patterns.length).toBeGreaterThan(0);

    // All patterns should have valid scores
    for (const p of result.patterns) {
      expect(p.compositeScore).toBeGreaterThanOrEqual(0);
      expect(p.compositeScore).toBeLessThanOrEqual(100);
    }
  });

  it("persists discovered patterns to the database", () => {
    const eventRepo = new EventRepository(getDb());
    const patternRepo = new PatternRepository(getDb());

    insertWorkflowSession(eventRepo, "user-1", "2026-01-15T09:00:00Z");
    insertWorkflowSession(eventRepo, "user-1", "2026-01-15T11:00:00Z");
    insertWorkflowSession(eventRepo, "user-1", "2026-01-15T14:00:00Z");

    const result = runReportPipeline(getDb());

    // Check patterns were persisted
    for (const sp of result.patterns) {
      const row = patternRepo.findById(sp.patternId);
      expect(row).toBeDefined();
      expect(row!.name).toBe(sp.name);

      const meta = JSON.parse(row!.metadata);
      expect(meta.compositeScore).toBe(sp.compositeScore);
    }
  });

  it("upserts patterns on repeated runs", () => {
    const eventRepo = new EventRepository(getDb());

    insertWorkflowSession(eventRepo, "user-1", "2026-01-15T09:00:00Z");
    insertWorkflowSession(eventRepo, "user-1", "2026-01-15T11:00:00Z");

    // Run twice — should not throw on duplicate insert
    runReportPipeline(getDb());
    const result = runReportPipeline(getDb());

    expect(result.patterns.length).toBeGreaterThan(0);
  });

  it("filters patterns by --min-score", () => {
    const repo = new EventRepository(getDb());

    insertWorkflowSession(repo, "user-1", "2026-01-15T09:00:00Z");
    insertWorkflowSession(repo, "user-1", "2026-01-15T11:00:00Z");
    insertWorkflowSession(repo, "user-1", "2026-01-15T14:00:00Z");

    // With very high minScore, should filter out most/all patterns
    const result = runReportPipeline(getDb(), { minScore: 101 });
    expect(result.patterns).toEqual([]);
    // But the pipeline still ran
    expect(result.totalMinedPatterns).toBeGreaterThan(0);
  });

  it("limits output to --top N patterns", () => {
    const repo = new EventRepository(getDb());

    // Create sessions with varied workflows to produce multiple patterns
    insertWorkflowSession(repo, "user-1", "2026-01-15T09:00:00Z");
    insertWorkflowSession(repo, "user-1", "2026-01-15T11:00:00Z");
    insertWorkflowSession(repo, "user-1", "2026-01-15T14:00:00Z");

    const result = runReportPipeline(getDb(), { top: 1 });
    expect(result.patterns.length).toBeLessThanOrEqual(1);
  });

  it("respects --since date filter", () => {
    const repo = new EventRepository(getDb());

    // Two sessions before the cutoff
    insertWorkflowSession(repo, "user-1", "2026-01-10T09:00:00Z");
    insertWorkflowSession(repo, "user-1", "2026-01-10T11:00:00Z");
    // One session after — not enough for minSupport=2
    insertWorkflowSession(repo, "user-1", "2026-01-20T09:00:00Z");

    const result = runReportPipeline(getDb(), {
      since: "2026-01-15T00:00:00Z",
    });

    // Only 3 events (1 session) after the cutoff, not enough for patterns
    expect(result.totalEvents).toBe(3);
    expect(result.patterns).toEqual([]);
  });

  it("handles single session (not enough for pattern mining)", () => {
    const repo = new EventRepository(getDb());

    insertWorkflowSession(repo, "user-1", "2026-01-15T09:00:00Z");

    const result = runReportPipeline(getDb());

    expect(result.totalEvents).toBe(3);
    expect(result.totalSessions).toBe(1);
    expect(result.patterns).toEqual([]);
  });
});
