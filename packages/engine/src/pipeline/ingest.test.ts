import { describe, it, expect, vi } from "vitest";
import { runIngest, type IngestDependencies, type IngestOptions } from "./ingest.js";
import type { ConnectorInterface, ConnectorConfig, RawEvent } from "../connectors/types.js";
import type { Config } from "../config/schema.js";
import type { InsertEvent } from "../db/repositories/event-repository.js";

function makeRawEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: overrides.id ?? "test-event-1",
    source: overrides.source ?? "slack",
    type: overrides.type ?? "message_sent",
    timestamp: overrides.timestamp ?? new Date("2025-01-15T10:00:00Z"),
    participants: overrides.participants ?? [
      { id: "user1", name: "Alice", type: "person" },
      { id: "chan1", name: "#general", type: "channel" },
    ],
    data: overrides.data ?? { text: "hello" },
  };
}

function makeConnector(
  source: string,
  events: readonly RawEvent[] = [makeRawEvent({ source })],
): ConnectorInterface {
  const fetchEvents = vi.fn(async function* (): AsyncIterable<readonly RawEvent[]> {
    if (events.length > 0) {
      yield events;
    }
  });
  return { source, fetchEvents };
}

function makeFailingConnector(source: string, error: string): ConnectorInterface {
  const fetchEvents = vi.fn(async function* (): AsyncIterable<readonly RawEvent[]> {
    throw new Error(error);
    // eslint-disable-next-line no-unreachable
    yield [];
  });
  return { source, fetchEvents };
}

const baseConfig: Config = {
  gmail: { clientId: "gid", clientSecret: "gsec", refreshToken: "grt" },
  slack: { botToken: "xoxb-test" },
  linear: { apiKey: "lin-key" },
  calendar: { clientId: "cid", clientSecret: "csec", refreshToken: "crt" },
};

const defaultOptions: IngestOptions = { source: "all", days: 30, dryRun: false };

function makeDeps(overrides: Partial<IngestDependencies> = {}): IngestDependencies {
  return {
    config: overrides.config ?? baseConfig,
    insertMany: overrides.insertMany ?? vi.fn(),
    connectors: overrides.connectors ?? {
      gmail: makeConnector("gmail", [makeRawEvent({ id: "gmail-1", source: "gmail" })]),
      slack: makeConnector("slack", [makeRawEvent({ id: "slack-1", source: "slack" })]),
      linear: makeConnector("linear", [
        makeRawEvent({ id: "linear-1", source: "linear", type: "issue_created" }),
      ]),
      calendar: makeConnector("calendar", [
        makeRawEvent({ id: "cal-1", source: "calendar", type: "meeting_scheduled", participants: [
          { id: "org1", name: "Bob", type: "organizer" },
          { id: "att1", name: "Alice", type: "attendee" },
        ] }),
      ]),
    },
    log: overrides.log ?? vi.fn(),
  };
}

describe("runIngest", () => {
  it("ingests from all configured sources", async () => {
    const deps = makeDeps();
    const result = await runIngest(defaultOptions, deps);

    expect(result.totalEvents).toBe(4);
    expect(Object.keys(result.sourceCounts)).toEqual(["gmail", "slack", "linear", "calendar"]);
    expect(result.errors).toHaveLength(0);
    expect(result.skippedSources).toHaveLength(0);

    const insertMany = deps.insertMany as ReturnType<typeof vi.fn>;
    expect(insertMany).toHaveBeenCalledTimes(4);
  });

  it("ingests from a single source when specified", async () => {
    const deps = makeDeps();
    const result = await runIngest({ source: "slack", days: 7, dryRun: false }, deps);

    expect(result.totalEvents).toBe(1);
    expect(result.sourceCounts).toEqual({ slack: 1 });
    expect(result.skippedSources).toHaveLength(0);

    const slackConnector = deps.connectors!["slack"];
    const fetchEvents = slackConnector.fetchEvents as ReturnType<typeof vi.fn>;
    expect(fetchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ lookbackDays: 7 }),
    );
  });

  it("skips sources with missing config", async () => {
    const config: Config = { slack: { botToken: "xoxb-test" } };
    const deps = makeDeps({ config });
    const result = await runIngest(defaultOptions, deps);

    expect(result.totalEvents).toBe(1);
    expect(result.sourceCounts).toEqual({ slack: 1 });
    expect(result.skippedSources).toEqual(["gmail", "linear", "calendar"]);
  });

  it("does not write to DB in dry-run mode", async () => {
    const deps = makeDeps();
    const result = await runIngest({ source: "all", days: 30, dryRun: true }, deps);

    expect(result.totalEvents).toBe(4);
    const insertMany = deps.insertMany as ReturnType<typeof vi.fn>;
    expect(insertMany).not.toHaveBeenCalled();
  });

  it("continues when one connector fails", async () => {
    const deps = makeDeps({
      connectors: {
        gmail: makeFailingConnector("gmail", "Auth failed"),
        slack: makeConnector("slack", [makeRawEvent({ id: "slack-1", source: "slack" })]),
        linear: makeConnector("linear", [makeRawEvent({ id: "linear-1", source: "linear", type: "issue_created" })]),
        calendar: makeConnector("calendar", [makeRawEvent({ id: "cal-1", source: "calendar", type: "meeting_scheduled", participants: [{ id: "org1", name: "Bob", type: "organizer" }] })]),
      },
    });

    const result = await runIngest(defaultOptions, deps);

    expect(result.totalEvents).toBe(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe("Auth failed");
    expect(result.sourceCounts["gmail"]).toBeUndefined();
    expect(result.sourceCounts["slack"]).toBe(1);
  });

  it("passes correct credentials per source", async () => {
    const deps = makeDeps();
    await runIngest({ source: "gmail", days: 14, dryRun: false }, deps);

    const gmailConnector = deps.connectors!["gmail"];
    const fetchEvents = gmailConnector.fetchEvents as ReturnType<typeof vi.fn>;
    expect(fetchEvents).toHaveBeenCalledWith({
      credentials: {
        GMAIL_CLIENT_ID: "gid",
        GMAIL_CLIENT_SECRET: "gsec",
        GMAIL_REFRESH_TOKEN: "grt",
      },
      lookbackDays: 14,
    });
  });

  it("maps normalized events to InsertEvent format", async () => {
    const inserted: InsertEvent[][] = [];
    const deps = makeDeps({
      insertMany: vi.fn((events: InsertEvent[]) => inserted.push(events)),
      connectors: {
        slack: makeConnector("slack", [makeRawEvent({ id: "slack-42", source: "slack" })]),
        gmail: makeConnector("gmail"),
        linear: makeConnector("linear"),
        calendar: makeConnector("calendar"),
      },
    });

    await runIngest({ source: "slack", days: 30, dryRun: false }, deps);

    expect(inserted).toHaveLength(1);
    const event = inserted[0][0];
    expect(event.source_system).toBe("slack");
    expect(event.event_type).toBe("message_sent");
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.actor_id).not.toBe("unknown");
    expect(JSON.parse(event.entity_refs!)).toHaveLength(2);
  });

  it("propagates DB write failures instead of treating them as fetch errors", async () => {
    const dbError = new Error("database is locked");
    const insertMany = vi.fn(() => {
      throw dbError;
    });

    const deps = makeDeps({
      insertMany,
      connectors: {
        slack: makeConnector("slack", [makeRawEvent({ id: "s-1", source: "slack" })]),
        gmail: makeConnector("gmail"),
        linear: makeConnector("linear"),
        calendar: makeConnector("calendar"),
      },
    });

    await expect(
      runIngest({ source: "slack", days: 30, dryRun: false }, deps),
    ).rejects.toThrow("database is locked");
  });

  it("preserves partial count when streaming connector fails mid-stream", async () => {
    const partiallyFailingConnector: ConnectorInterface = {
      source: "slack",
      fetchEvents: vi.fn(async function* (): AsyncIterable<readonly RawEvent[]> {
        yield [makeRawEvent({ id: "s-page1-a", source: "slack" })];
        yield [makeRawEvent({ id: "s-page2-a", source: "slack" })];
        throw new Error("upstream rate-limited on page 3");
      }),
    };

    const deps = makeDeps({
      connectors: {
        slack: partiallyFailingConnector,
        gmail: makeConnector("gmail"),
        linear: makeConnector("linear"),
        calendar: makeConnector("calendar"),
      },
    });

    const result = await runIngest({ source: "slack", days: 30, dryRun: false }, deps);

    expect(result.sourceCounts["slack"]).toBe(2);
    expect(result.totalEvents).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe("upstream rate-limited on page 3");
  });

  it("handles empty event list from connector", async () => {
    const deps = makeDeps({
      connectors: {
        slack: makeConnector("slack", []),
        gmail: makeConnector("gmail"),
        linear: makeConnector("linear"),
        calendar: makeConnector("calendar"),
      },
    });

    const result = await runIngest({ source: "slack", days: 30, dryRun: false }, deps);

    expect(result.totalEvents).toBe(0);
    expect(result.sourceCounts).toEqual({ slack: 0 });
    const insertMany = deps.insertMany as ReturnType<typeof vi.fn>;
    expect(insertMany).toHaveBeenCalledWith([]);
  });
});
