import { describe, it, expect, vi } from "vitest";
import { GitHubConnector } from "./github.js";
import type { ConnectorConfig } from "./types.js";

function mockIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    number: 42,
    title: "Fix login bug",
    body: "Login fails",
    state: "open",
    created_at: "2026-04-10T10:00:00Z",
    updated_at: "2026-04-10T10:00:00Z",
    user: { login: "alice", id: 1 },
    assignee: { login: "bob", id: 2 },
    labels: [{ name: "bug" }],
    html_url: "https://github.com/acme/repo/issues/42",
    ...overrides,
  };
}

function mockPR(overrides: Record<string, unknown> = {}) {
  return mockIssue({
    id: 2001,
    number: 100,
    pull_request: { url: "https://api.github.com/repos/acme/repo/pulls/100" },
    html_url: "https://github.com/acme/repo/pull/100",
    ...overrides,
  });
}

function mockCommit(overrides: Record<string, unknown> = {}) {
  return {
    sha: "abc123def456",
    commit: {
      message: "feat: add login\n\nFull body here",
      author: { name: "Alice", date: "2026-04-10T11:00:00Z" },
    },
    author: { login: "alice", id: 1 },
    html_url: "https://github.com/acme/repo/commit/abc123",
    ...overrides,
  };
}

const baseConfig: ConnectorConfig = {
  credentials: { GITHUB_TOKEN: "ghp_test", GITHUB_REPOS: "acme/repo" },
  lookbackDays: 7,
};

function makeFetchFn(issueResults: unknown[], commitResults: unknown[], reviewResults: unknown[] = []) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/issues?")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => issueResults });
    }
    if (url.includes("/commits?")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => commitResults });
    }
    if (url.includes("/reviews?")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => reviewResults });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

describe("GitHubConnector", () => {
  it("implements ConnectorInterface with source 'github'", () => {
    const connector = new GitHubConnector();
    expect(connector.source).toBe("github");
  });

  it("throws when GITHUB_TOKEN is missing", async () => {
    const connector = new GitHubConnector();
    await expect(
      connector.fetchEvents({ credentials: { GITHUB_REPOS: "a/b" }, lookbackDays: 7 }),
    ).rejects.toThrow("Missing GITHUB_TOKEN in credentials");
  });

  it("throws when GITHUB_REPOS is missing", async () => {
    const connector = new GitHubConnector();
    await expect(
      connector.fetchEvents({ credentials: { GITHUB_TOKEN: "ghp" }, lookbackDays: 7 }),
    ).rejects.toThrow("Missing GITHUB_REPOS");
  });

  it("creates issue_created events for issues", async () => {
    const fetchFn = makeFetchFn([mockIssue()], []);
    const connector = new GitHubConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const created = events.filter((e) => e.type === "issue_created");

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(
      expect.objectContaining({
        id: "github-issue-1001",
        source: "github",
        timestamp: "2026-04-10T10:00:00Z",
      }),
    );
    expect(created[0].data).toEqual(
      expect.objectContaining({
        repo: "acme/repo",
        number: 42,
        title: "Fix login bug",
        isPullRequest: false,
        labels: ["bug"],
      }),
    );
    expect(created[0].participants).toEqual([
      { id: "alice", name: "alice", type: "person" },
      { id: "bob", name: "bob", type: "person" },
    ]);
  });

  it("creates pr_opened events for pull requests", async () => {
    const fetchFn = makeFetchFn([mockPR()], []);
    const connector = new GitHubConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const opened = events.filter((e) => e.type === "pr_opened");

    expect(opened).toHaveLength(1);
    expect(opened[0].id).toBe("github-pr-2001");
    expect(opened[0].data.isPullRequest).toBe(true);
  });

  it("creates issue_closed / pr_merged events when closed_at is in window", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const fetchFn = makeFetchFn(
      [
        mockIssue({ closed_at: yesterday, state: "closed" }),
        mockPR({ closed_at: yesterday, state: "closed" }),
      ],
      [],
    );
    const connector = new GitHubConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    expect(events.filter((e) => e.type === "issue_closed")).toHaveLength(1);
    expect(events.filter((e) => e.type === "pr_merged")).toHaveLength(1);
  });

  it("fetches PR reviews and creates review_submitted events", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const review = {
      id: 9001,
      user: { login: "reviewer", id: 3 },
      state: "APPROVED",
      submitted_at: yesterday,
      body: "LGTM",
    };
    const fetchFn = makeFetchFn([mockPR()], [], [review]);
    const connector = new GitHubConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const reviews = events.filter((e) => e.type === "review_submitted");

    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe("github-review-9001");
    expect(reviews[0].data).toEqual(
      expect.objectContaining({
        reviewState: "APPROVED",
        body: "LGTM",
      }),
    );
  });

  it("creates commit_pushed events from commits", async () => {
    const fetchFn = makeFetchFn([], [mockCommit()]);
    const connector = new GitHubConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const commits = events.filter((e) => e.type === "commit_pushed");

    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual(
      expect.objectContaining({
        id: "github-commit-abc123def456",
        source: "github",
      }),
    );
    expect(commits[0].data).toEqual(
      expect.objectContaining({
        repo: "acme/repo",
        sha: "abc123d",
        message: "feat: add login", // first line only
      }),
    );
  });

  it("handles commits without an associated GitHub user (author is null)", async () => {
    const fetchFn = makeFetchFn([], [mockCommit({ author: null })]);
    const connector = new GitHubConnector(fetchFn);

    const events = await connector.fetchEvents(baseConfig);
    const commits = events.filter((e) => e.type === "commit_pushed");
    expect(commits).toHaveLength(1);
    expect(commits[0].participants[0]).toEqual({
      id: "Alice",
      name: "Alice",
      type: "person",
    });
  });

  it("uses correct auth headers", async () => {
    const fetchFn = makeFetchFn([mockIssue()], []);
    const connector = new GitHubConnector(fetchFn);

    await connector.fetchEvents(baseConfig);

    const firstCall = fetchFn.mock.calls[0];
    expect(firstCall[1].headers.Authorization).toBe("Bearer ghp_test");
    expect(firstCall[1].headers.Accept).toBe("application/vnd.github+json");
    expect(firstCall[1].headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("handles multiple repos", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/acme/repo1/issues")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [mockIssue({ id: 100 })] });
      }
      if (url.includes("/acme/repo2/issues")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [mockIssue({ id: 200 })] });
      }
      // commits endpoints
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    });

    const connector = new GitHubConnector(fetchFn);
    const events = await connector.fetchEvents({
      credentials: { GITHUB_TOKEN: "ghp", GITHUB_REPOS: "acme/repo1, acme/repo2" },
      lookbackDays: 7,
    });

    const created = events.filter((e) => e.type === "issue_created");
    expect(created).toHaveLength(2);
    expect(created.map((e) => e.data.repo).sort()).toEqual(["acme/repo1", "acme/repo2"]);
  });

  it("throws on API errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    const connector = new GitHubConnector(fetchFn);
    await expect(connector.fetchEvents(baseConfig)).rejects.toThrow("GitHub API error: HTTP 401");
  });
});
