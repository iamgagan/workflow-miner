import { describe, it, expect, vi } from "vitest";
import { JiraConnector } from "./jira.js";
import type { ConnectorConfig } from "./types.js";

function mockJiraIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "10001",
    key: "ENG-42",
    fields: {
      summary: "Sprint planning ticket",
      description: "Plan next sprint",
      status: { name: "In Progress" },
      issuetype: { name: "Task" },
      priority: { name: "High" },
      assignee: { accountId: "acc-2", displayName: "Alice" },
      reporter: { accountId: "acc-1", displayName: "Bob" },
      created: "2026-04-05T10:00:00Z",
      updated: "2026-04-10T10:00:00Z",
      resolutiondate: null,
      labels: ["backend", "sprint-12"],
      project: { key: "ENG", name: "Engineering" },
      comment: { comments: [] },
      changelog: { histories: [] },
      ...(overrides.fields ?? {}),
    },
    ...overrides,
  };
}

function makeFetchFn(issues: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ issues }),
  });
}

const baseConfig: ConnectorConfig = {
  credentials: {
    JIRA_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "jira_test_token",
    JIRA_DOMAIN: "mycompany.atlassian.net",
  },
  lookbackDays: 7,
};

describe("JiraConnector", () => {
  it("implements ConnectorInterface with source 'jira'", () => {
    const connector = new JiraConnector();
    expect(connector.source).toBe("jira");
  });

  it("throws when JIRA_EMAIL, JIRA_API_TOKEN, or JIRA_DOMAIN is missing", async () => {
    const connector = new JiraConnector();
    await expect(
      connector.fetchEvents({ credentials: { JIRA_EMAIL: "x", JIRA_API_TOKEN: "y" }, lookbackDays: 7 }),
    ).rejects.toThrow(/Missing JIRA_/);
    await expect(
      connector.fetchEvents({ credentials: { JIRA_API_TOKEN: "y", JIRA_DOMAIN: "z" }, lookbackDays: 7 }),
    ).rejects.toThrow(/Missing JIRA_/);
  });

  it("creates issue_created events with project metadata", async () => {
    const issue = mockJiraIssue();
    const fetchFn = makeFetchFn([issue]);
    const connector = new JiraConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain("https://mycompany.atlassian.net/rest/api/3/search");
    expect(url).toContain("jql=");
    // Basic auth header: base64(email:token)
    const expectedAuth = Buffer.from("user@example.com:jira_test_token").toString("base64");
    expect(init.headers.Authorization).toBe(`Basic ${expectedAuth}`);

    const created = events.filter((e) => e.type === "issue_created");
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(
      expect.objectContaining({
        id: "jira-issue-10001",
        source: "jira",
        type: "issue_created",
        timestamp: "2026-04-05T10:00:00Z",
      }),
    );
    expect(created[0].data).toEqual(
      expect.objectContaining({
        project: "ENG",
        issueKey: "ENG-42",
        summary: "Sprint planning ticket",
        status: "In Progress",
        issueType: "Task",
        priority: "High",
        labels: ["backend", "sprint-12"],
      }),
    );
    expect(created[0].participants).toEqual([
      { id: "acc-1", name: "Bob", type: "person" },
      { id: "acc-2", name: "Alice", type: "person" },
    ]);
  });

  it("emits issue_closed when resolution date is in window", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const issue = mockJiraIssue({
      fields: {
        ...mockJiraIssue().fields,
        resolutiondate: yesterday,
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new JiraConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const closed = events.filter((e) => e.type === "issue_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0].id).toBe("jira-resolved-10001");
  });

  it("skips issue_closed when resolution date is outside window", async () => {
    const issue = mockJiraIssue({
      fields: {
        ...mockJiraIssue().fields,
        resolutiondate: "2020-01-01T00:00:00Z",
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new JiraConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    expect(events.filter((e) => e.type === "issue_closed")).toHaveLength(0);
  });

  it("maps status changes from changelog to issue_updated events", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const issue = mockJiraIssue({
      fields: {
        ...mockJiraIssue().fields,
        changelog: {
          histories: [
            {
              id: "hist-1",
              created: yesterday,
              author: { accountId: "acc-1", displayName: "Bob" },
              items: [
                { field: "status", fromString: "To Do", toString: "In Progress" },
              ],
            },
          ],
        },
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new JiraConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const updated = events.filter((e) => e.type === "issue_updated");

    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe("jira-transition-hist-1");
    expect(updated[0].data).toEqual(
      expect.objectContaining({
        fromStatus: "To Do",
        toStatus: "In Progress",
      }),
    );
  });

  it("ignores non-status field changes in changelog", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const issue = mockJiraIssue({
      fields: {
        ...mockJiraIssue().fields,
        changelog: {
          histories: [
            {
              id: "hist-2",
              created: yesterday,
              author: { accountId: "acc-1", displayName: "Bob" },
              items: [{ field: "summary", fromString: "old", toString: "new" }],
            },
          ],
        },
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new JiraConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    expect(events.filter((e) => e.type === "issue_updated")).toHaveLength(0);
  });

  it("maps comments to comment_added events", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const issue = mockJiraIssue({
      fields: {
        ...mockJiraIssue().fields,
        comment: {
          comments: [
            {
              id: "comment-1",
              body: "Working on this now",
              created: yesterday,
              author: { accountId: "acc-1", displayName: "Bob" },
            },
          ],
        },
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new JiraConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const comments = events.filter((e) => e.type === "comment_added");

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("jira-comment-comment-1");
    expect(comments[0].data).toEqual(
      expect.objectContaining({
        commentBody: "Working on this now",
      }),
    );
  });

  it("handles ADF (rich text) comment bodies by serializing to JSON", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const issue = mockJiraIssue({
      fields: {
        ...mockJiraIssue().fields,
        comment: {
          comments: [
            {
              id: "adf-1",
              body: { type: "doc", content: [{ type: "text", text: "Hello" }] },
              created: yesterday,
              author: { accountId: "acc-1", displayName: "Bob" },
            },
          ],
        },
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new JiraConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const comments = events.filter((e) => e.type === "comment_added");
    expect(comments[0].data.commentBody).toContain("Hello");
  });

  it("throws on API errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    });

    const connector = new JiraConnector(fetchFn);
    await expect(connector.fetchEvents(baseConfig)).rejects.toThrow("Jira API error: HTTP 401");
  });

  it("handles issues without assignee or priority", async () => {
    const issue = mockJiraIssue({
      fields: {
        ...mockJiraIssue().fields,
        assignee: undefined,
        priority: undefined,
      },
    });
    const fetchFn = makeFetchFn([issue]);
    const connector = new JiraConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const created = events.filter((e) => e.type === "issue_created");
    expect(created).toHaveLength(1);
    // Only reporter, no assignee
    expect(created[0].participants.filter((p) => p.type === "person")).toHaveLength(1);
  });
});
