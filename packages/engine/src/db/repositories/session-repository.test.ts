import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseClient } from "../client";
import { SessionRepository, type InsertSession } from "./session-repository";

function makeSession(overrides: Partial<InsertSession> = {}): InsertSession {
  return {
    session_id: `sess-${Math.random().toString(36).slice(2, 10)}`,
    actor_id: "user-1",
    start_time: "2026-01-15T09:00:00Z",
    end_time: "2026-01-15T10:00:00Z",
    event_count: 10,
    ...overrides,
  };
}

describe("db/session-repository", () => {
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

  it("inserts and retrieves a session", () => {
    repo.insert(makeSession({ session_id: "sess-1", event_count: 25 }));

    const found = repo.findById("sess-1");
    expect(found).toBeDefined();
    expect(found!.session_id).toBe("sess-1");
    expect(found!.actor_id).toBe("user-1");
    expect(found!.event_count).toBe(25);
  });

  it("returns undefined for non-existent session", () => {
    expect(repo.findById("nonexistent")).toBeUndefined();
  });

  it("inserts many sessions in a transaction", () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({
        session_id: `sess-${i}`,
        start_time: `2026-01-${String(i + 1).padStart(2, "0")}T09:00:00Z`,
        end_time: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      })
    );
    repo.insertMany(sessions);

    const results = repo.query({ limit: 100 });
    expect(results).toHaveLength(20);
  });

  it("queries by actor_id", () => {
    repo.insert(makeSession({ session_id: "s1", actor_id: "alice" }));
    repo.insert(makeSession({ session_id: "s2", actor_id: "bob" }));
    repo.insert(makeSession({ session_id: "s3", actor_id: "alice" }));

    const results = repo.query({ actor_id: "alice" });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.actor_id === "alice")).toBe(true);
  });

  it("queries by time range", () => {
    repo.insert(makeSession({
      session_id: "s1",
      start_time: "2026-01-10T09:00:00Z",
      end_time: "2026-01-10T10:00:00Z",
    }));
    repo.insert(makeSession({
      session_id: "s2",
      start_time: "2026-01-15T09:00:00Z",
      end_time: "2026-01-15T10:00:00Z",
    }));
    repo.insert(makeSession({
      session_id: "s3",
      start_time: "2026-01-20T09:00:00Z",
      end_time: "2026-01-20T10:00:00Z",
    }));

    const results = repo.query({
      after: "2026-01-12T00:00:00Z",
      before: "2026-01-18T00:00:00Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0].session_id).toBe("s2");
  });

  it("supports pagination", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({
        session_id: `sess-${i}`,
        start_time: `2026-01-${String(i + 1).padStart(2, "0")}T09:00:00Z`,
        end_time: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      })
    );
    repo.insertMany(sessions);

    const page1 = repo.query({ limit: 3, offset: 0 });
    const page2 = repo.query({ limit: 3, offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0].session_id).not.toBe(page2[0].session_id);
  });

  it("counts sessions by actor", () => {
    repo.insert(makeSession({ session_id: "s1", actor_id: "alice" }));
    repo.insert(makeSession({ session_id: "s2", actor_id: "alice" }));
    repo.insert(makeSession({ session_id: "s3", actor_id: "bob" }));

    const counts = repo.countByActor();
    expect(counts.alice).toBe(2);
    expect(counts.bob).toBe(1);
  });

  it("stores JSON fields correctly", () => {
    const sourceSystems = JSON.stringify(["slack", "gmail"]);
    const metadata = JSON.stringify({ topic: "standup" });

    repo.insert(
      makeSession({
        session_id: "json-test",
        source_systems: sourceSystems,
        metadata,
      })
    );

    const found = repo.findById("json-test")!;
    expect(JSON.parse(found.source_systems)).toEqual(["slack", "gmail"]);
    expect(JSON.parse(found.metadata)).toEqual({ topic: "standup" });
  });
});
