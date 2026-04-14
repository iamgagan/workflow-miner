import type { ConnectorConfig, ConnectorInterface, RawEvent, RawParticipant } from "./types.js";
import { fetchWithRetry } from "./http-utils.js";

const GITHUB_API = "https://api.github.com";
const PER_PAGE = 100;

interface GitHubUser {
  readonly login: string;
  readonly id: number;
}

interface GitHubIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body?: string;
  readonly state: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at?: string;
  readonly user: GitHubUser;
  readonly assignee?: GitHubUser;
  readonly labels: readonly { name: string }[];
  readonly pull_request?: { url: string };
  readonly html_url: string;
}

interface GitHubPRReview {
  readonly id: number;
  readonly user: GitHubUser;
  readonly state: string;
  readonly submitted_at: string;
  readonly body?: string;
}

interface GitHubCommit {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: { readonly name: string; readonly date: string };
  };
  readonly author?: GitHubUser;
  readonly html_url: string;
}

interface FetchFn {
  (url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

function userToParticipant(user: GitHubUser): RawParticipant {
  return { id: user.login, name: user.login, type: "person" };
}

export class GitHubConnector implements ConnectorInterface {
  readonly source = "github";

  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  async fetchEvents(config: ConnectorConfig): Promise<readonly RawEvent[]> {
    const token = config.credentials["GITHUB_TOKEN"];
    if (!token) throw new Error("Missing GITHUB_TOKEN in credentials");

    const repos = (config.credentials["GITHUB_REPOS"] ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);

    if (repos.length === 0) {
      throw new Error("Missing GITHUB_REPOS in credentials (comma-separated owner/repo list)");
    }

    const since = new Date();
    since.setDate(since.getDate() - config.lookbackDays);
    const sinceISO = since.toISOString();

    const events: RawEvent[] = [];

    for (const repo of repos) {
      const [issues, commits] = await Promise.all([
        this.fetchIssuesAndPRs(token, repo, sinceISO),
        this.fetchCommits(token, repo, sinceISO),
      ]);

      for (const issue of issues) {
        const isPR = Boolean(issue.pull_request);
        const participants: RawParticipant[] = [userToParticipant(issue.user)];
        if (issue.assignee) participants.push(userToParticipant(issue.assignee));

        events.push({
          id: `github-${isPR ? "pr" : "issue"}-${issue.id}`,
          source: "github",
          type: isPR ? "pr_opened" : "issue_created",
          timestamp: issue.created_at,
          participants,
          data: {
            repo,
            number: issue.number,
            title: issue.title,
            state: issue.state,
            labels: issue.labels.map((l) => l.name),
            url: issue.html_url,
            isPullRequest: isPR,
          },
        });

        if (issue.closed_at && new Date(issue.closed_at) >= since) {
          events.push({
            id: `github-${isPR ? "pr" : "issue"}-${issue.id}-closed`,
            source: "github",
            type: isPR ? "pr_merged" : "issue_closed",
            timestamp: issue.closed_at,
            participants,
            data: { repo, number: issue.number, title: issue.title, url: issue.html_url },
          });
        }

        // Fetch PR reviews
        if (isPR) {
          const reviews = await this.fetchPRReviews(token, repo, issue.number);
          for (const review of reviews) {
            if (new Date(review.submitted_at) < since) continue;
            events.push({
              id: `github-review-${review.id}`,
              source: "github",
              type: "review_submitted",
              timestamp: review.submitted_at,
              participants: [userToParticipant(review.user), userToParticipant(issue.user)],
              data: {
                repo,
                prNumber: issue.number,
                prTitle: issue.title,
                reviewState: review.state,
                body: (review.body ?? "").slice(0, 500),
              },
            });
          }
        }
      }

      for (const commit of commits) {
        const author = commit.author
          ? userToParticipant(commit.author)
          : { id: commit.commit.author.name, name: commit.commit.author.name, type: "person" as const };

        events.push({
          id: `github-commit-${commit.sha}`,
          source: "github",
          type: "commit_pushed",
          timestamp: commit.commit.author.date,
          participants: [author],
          data: {
            repo,
            sha: commit.sha.slice(0, 7),
            message: commit.commit.message.split("\n")[0].slice(0, 200),
            url: commit.html_url,
          },
        });
      }
    }

    return events;
  }

  private async fetchIssuesAndPRs(token: string, repo: string, since: string): Promise<GitHubIssue[]> {
    const url = `${GITHUB_API}/repos/${repo}/issues?state=all&since=${since}&per_page=${PER_PAGE}&sort=updated&direction=desc`;
    const response = await this.request(token, url);
    return response as GitHubIssue[];
  }

  private async fetchCommits(token: string, repo: string, since: string): Promise<GitHubCommit[]> {
    const url = `${GITHUB_API}/repos/${repo}/commits?since=${since}&per_page=${PER_PAGE}`;
    const response = await this.request(token, url);
    return response as GitHubCommit[];
  }

  private async fetchPRReviews(token: string, repo: string, prNumber: number): Promise<GitHubPRReview[]> {
    const url = `${GITHUB_API}/repos/${repo}/pulls/${prNumber}/reviews?per_page=${PER_PAGE}`;
    const response = await this.request(token, url);
    return response as GitHubPRReview[];
  }

  private async request(token: string, url: string): Promise<unknown> {
    const response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }, { fetchFn: this.fetchFn as unknown as (url: string, init?: RequestInit) => Promise<Response> });

    if (!response.ok) {
      throw new Error(`GitHub API error: HTTP ${response.status}`);
    }
    return response.json();
  }
}
