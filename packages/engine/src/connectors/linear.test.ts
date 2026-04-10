import { describe, it, expect, vi } from "vitest";
import { LinearConnector } from "./linear.js";
import type { ConnectorConfig } from "./types.js";

function mockIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "ENG-123",
    title: "Fix login bug",
    description: "Login fails on Safari",
    createdAt: "2026-04-01T10:00:00Z",
    updatedAt: "2026-04-05T14:00:00Z",
    state: { id: "state-1", name: "In Progress" },
    assignee: { id: "user-2", name: "Alice", email: "alice@example.com" },
    creator: { id: "user-1", name: "Bob", email: "bob@example.com" },
    labels: { nodes: [{ id: "label-1", name: "bug" }] },
    project: { id: "proj-1", name: "Backend" },
    cycle: { id: "cycle-1", number: 5, name: "Sprint 5" },
    priority: 2,
    priorityLabel: "High",
    comments: { nodes: [] },
    history: { nodes: [] },
    ...overrides,
  };
}

function makeFetchFn(issues: unknown[], hasNextPage = false, endCursor: string | null = null) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        issues: {
          nodes: issues,
          pageInfo: { hasNextPage, endCursor },
        },
      },
    }),
  });
}

const baseConfig: ConnectorConfig = {
  credentials: { LINEAR_API_KEY: "lin_test_key" },
  lookbackDays: 7,
};

describe("LinearConnector", () => {
  it("implements ConnectorInterface with source 'linear'", () => {
    const connector = new LinearConnector();
    expect(connector.source).toBe("linear");
  });

  it("throws when LINEAR_API_KEY is missing", async () => {
    const connector = new LinearConnector();
    await expect(
      connector.fetchEvents({ credentials: {}, lookbackDays: 7 }),
    ).rejects.toThrow("Missing LINEAR_API_KEY in credentials");
  });

  it("fetches issues and creates issue_created events", async () => {
    const issue = mockIssue();
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);

    expect(fetchFn).toHaveBeenCalledOnce();
    const callArgs = fetchFn.mock.calls[0];
    expect(callArgs[0]).toBe("https://api.linear.app/graphql");
    expect(callArgs[1].headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "lin_test_key",
    });

    const created = events.filter((e) => e.type === "issue_created");
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(
      expect.objectContaining({
        id: "linear-issue-issue-1",
        source: "linear",
        type: "issue_created",
        timestamp: "2026-04-01T10:00:00Z",
      }),
    );
    expect(created[0].data).toEqual(
      expect.objectContaining({
        title: "Fix login bug",
        description: "Login fails on Safari",
        state: "In Progress",
        identifier: "ENG-123",
        labels: ["bug"],
        project: "Backend",
      }),
    );
    expect(created[0].participants).toEqual([
      { id: "issue-1", name: "ENG-123", type: "issue" },
      { id: "user-1", name: "Bob", type: "person" },
      { id: "user-2", name: "Alice", type: "person" },
    ]);
  });

  it("maps state transitions to issue_updated events", async () => {
    const issue = mockIssue({
      history: {
        nodes: [
          {
            id: "hist-1",
            createdAt: "2026-04-03T12:00:00Z",
            fromState: { id: "s1", name: "Backlog" },
            toState: { id: "s2", name: "In Progress" },
            actor: { id: "user-1", name: "Bob" },
          },
          {
            id: "hist-2",
            createdAt: "2026-04-05T14:00:00Z",
            fromState: { id: "s2", name: "In Progress" },
            toState: { id: "s3", name: "Done" },
            actor: { id: "user-2", name: "Alice" },
          },
        ],
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const updated = events.filter((e) => e.type === "issue_updated");

    expect(updated).toHaveLength(2);
    expect(updated[0].data).toEqual(
      expect.objectContaining({
        changeType: "state",
        fromState: "Backlog",
        toState: "In Progress",
      }),
    );
    expect(updated[1].data).toEqual(
      expect.objectContaining({
        changeType: "state",
        fromState: "In Progress",
        toState: "Done",
      }),
    );
    expect(updated[0].participants).toContainEqual({
      id: "user-1",
      name: "Bob",
      type: "person",
    });
  });

  it("maps assignee changes to followup_assigned events", async () => {
    const issue = mockIssue({
      history: {
        nodes: [
          {
            id: "hist-3",
            createdAt: "2026-04-04T09:00:00Z",
            toAssignee: { id: "user-2", name: "Alice" },
            actor: { id: "user-1", name: "Bob" },
          },
        ],
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const assigned = events.filter((e) => e.type === "followup_assigned");

    expect(assigned).toHaveLength(1);
    expect(assigned[0].data).toEqual(
      expect.objectContaining({
        assignee: "Alice",
        previousAssignee: null,
      }),
    );
    expect(assigned[0].participants).toContainEqual({
      id: "user-2",
      name: "Alice",
      type: "person",
    });
    // Actor is different from assignee, so included
    expect(assigned[0].participants).toContainEqual({
      id: "user-1",
      name: "Bob",
      type: "person",
    });
  });

  it("skips actor in followup_assigned when actor is the assignee", async () => {
    const issue = mockIssue({
      history: {
        nodes: [
          {
            id: "hist-4",
            createdAt: "2026-04-04T09:00:00Z",
            toAssignee: { id: "user-2", name: "Alice" },
            actor: { id: "user-2", name: "Alice" },
          },
        ],
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const assigned = events.filter((e) => e.type === "followup_assigned");

    expect(assigned).toHaveLength(1);
    // Only issue + assignee, no duplicate actor
    const personParticipants = assigned[0].participants.filter((p) => p.type === "person");
    expect(personParticipants).toHaveLength(1);
  });

  it("maps comments to message_sent events", async () => {
    const issue = mockIssue({
      comments: {
        nodes: [
          {
            id: "comment-1",
            body: "Working on this now",
            createdAt: "2026-04-02T15:00:00Z",
            user: { id: "user-1", name: "Bob", email: "bob@example.com" },
          },
        ],
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const messages = events.filter((e) => e.type === "message_sent");

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("linear-comment-comment-1");
    expect(messages[0].data).toEqual(
      expect.objectContaining({
        body: "Working on this now",
        title: "Fix login bug",
      }),
    );
  });

  it("handles pagination across multiple pages", async () => {
    const issue1 = mockIssue({ id: "issue-1" });
    const issue2 = mockIssue({ id: "issue-2", identifier: "ENG-124" });

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            issues: {
              nodes: [issue1],
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            issues: {
              nodes: [issue2],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      });

    const connector = new LinearConnector(fetchFn);
    const events = await connector.fetchEvents(baseConfig);

    expect(fetchFn).toHaveBeenCalledTimes(2);

    // Second call should include the cursor
    const secondCallBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(secondCallBody.variables.after).toBe("cursor-1");

    const created = events.filter((e) => e.type === "issue_created");
    expect(created).toHaveLength(2);
  });

  it("throws on API errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });

    const connector = new LinearConnector(fetchFn);
    await expect(
      connector.fetchEvents({ credentials: { LINEAR_API_KEY: "bad_key" }, lookbackDays: 7 }),
    ).rejects.toThrow("Linear API error: HTTP 401");
  });

  it("handles issues with no assignee or creator", async () => {
    const issue = mockIssue({
      assignee: undefined,
      creator: undefined,
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const created = events.filter((e) => e.type === "issue_created");

    expect(created).toHaveLength(1);
    // Only issue participant, no person participants
    expect(created[0].participants).toEqual([
      { id: "issue-1", name: "ENG-123", type: "issue" },
    ]);
  });

  it("handles issues with no project or cycle", async () => {
    const issue = mockIssue({
      project: undefined,
      cycle: undefined,
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const created = events.filter((e) => e.type === "issue_created");

    expect(created[0].data).toEqual(
      expect.objectContaining({
        project: null,
        cycle: null,
      }),
    );
  });

  it("handles issue with no description", async () => {
    const issue = mockIssue({ description: undefined });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const created = events.filter((e) => e.type === "issue_created");
    expect(created[0].data).toEqual(expect.objectContaining({ description: "" }));
  });

  it("does not duplicate assignee changes when same assignee re-assigned", async () => {
    const issue = mockIssue({
      history: {
        nodes: [
          {
            id: "hist-5",
            createdAt: "2026-04-04T09:00:00Z",
            fromAssignee: { id: "user-2", name: "Alice" },
            toAssignee: { id: "user-2", name: "Alice" },
            actor: { id: "user-1", name: "Bob" },
          },
        ],
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const assigned = events.filter((e) => e.type === "followup_assigned");
    // Same from and to assignee — no event
    expect(assigned).toHaveLength(0);
  });

  it("generates correct event IDs to prevent duplicates", async () => {
    const issue = mockIssue({
      comments: {
        nodes: [
          { id: "c1", body: "Hello", createdAt: "2026-04-02T10:00:00Z", user: null },
          { id: "c2", body: "World", createdAt: "2026-04-02T11:00:00Z", user: null },
        ],
      },
      history: {
        nodes: [
          {
            id: "h1",
            createdAt: "2026-04-03T12:00:00Z",
            fromState: { id: "s1", name: "Backlog" },
            toState: { id: "s2", name: "Todo" },
            actor: null,
          },
        ],
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new LinearConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const ids = events.map((e) => e.id);

    expect(ids).toContain("linear-issue-issue-1");
    expect(ids).toContain("linear-comment-c1");
    expect(ids).toContain("linear-comment-c2");
    expect(ids).toContain("linear-history-h1");
    // All IDs are unique
    expect(new Set(ids).size).toBe(ids.length);
  });
});
