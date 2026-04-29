import type { ConnectorConfig, ConnectorInterface, RawEvent, RawParticipant } from "./types.js";
import { fetchWithRetry } from "./http-utils.js";

const MAX_RESULTS = 100;

interface JiraIssue {
  readonly id: string;
  readonly key: string;
  readonly fields: {
    readonly summary: string;
    readonly description?: string;
    readonly status: { readonly name: string };
    readonly issuetype: { readonly name: string };
    readonly priority?: { readonly name: string };
    readonly assignee?: { readonly accountId: string; readonly displayName: string };
    readonly reporter?: { readonly accountId: string; readonly displayName: string };
    readonly created: string;
    readonly updated: string;
    readonly resolutiondate?: string;
    readonly labels: readonly string[];
    readonly project: { readonly key: string; readonly name: string };
    readonly comment?: {
      readonly comments: readonly JiraComment[];
    };
    readonly changelog?: {
      readonly histories: readonly JiraHistory[];
    };
  };
}

interface JiraComment {
  readonly id: string;
  readonly body: string | Record<string, unknown>;
  readonly created: string;
  readonly author: { readonly accountId: string; readonly displayName: string };
}

interface JiraHistory {
  readonly id: string;
  readonly created: string;
  readonly author: { readonly accountId: string; readonly displayName: string };
  readonly items: readonly {
    readonly field: string;
    readonly fromString?: string;
    readonly toString?: string;
  }[];
}

interface FetchFn {
  (url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

function jiraUserToParticipant(user: { accountId: string; displayName: string }): RawParticipant {
  return { id: user.accountId, name: user.displayName, type: "person" };
}

export class JiraConnector implements ConnectorInterface {
  readonly source = "jira";

  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  async *fetchEvents(
    config: ConnectorConfig,
  ): AsyncIterable<readonly RawEvent[]> {
    const email = config.credentials["JIRA_EMAIL"];
    const apiToken = config.credentials["JIRA_API_TOKEN"];
    const domain = config.credentials["JIRA_DOMAIN"]; // e.g. "mycompany.atlassian.net"

    if (!email || !apiToken || !domain) {
      throw new Error("Missing JIRA_EMAIL, JIRA_API_TOKEN, or JIRA_DOMAIN in credentials");
    }

    const since = new Date();
    since.setDate(since.getDate() - config.lookbackDays);
    const sinceStr = since.toISOString().split("T")[0]; // YYYY-MM-DD

    const issues = await this.fetchIssues(email, apiToken, domain, sinceStr);
    const events: RawEvent[] = [];

    for (const issue of issues) {
      const participants: RawParticipant[] = [];
      if (issue.fields.reporter) participants.push(jiraUserToParticipant(issue.fields.reporter));
      if (issue.fields.assignee) participants.push(jiraUserToParticipant(issue.fields.assignee));

      const metadata = {
        project: issue.fields.project.key,
        issueKey: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        issueType: issue.fields.issuetype.name,
        priority: issue.fields.priority?.name,
        labels: issue.fields.labels,
      };

      // Issue created event
      events.push({
        id: `jira-issue-${issue.id}`,
        source: "jira",
        type: "issue_created",
        timestamp: issue.fields.created,
        participants,
        data: metadata,
      });

      // Resolution event
      if (issue.fields.resolutiondate && new Date(issue.fields.resolutiondate) >= since) {
        events.push({
          id: `jira-resolved-${issue.id}`,
          source: "jira",
          type: "issue_closed",
          timestamp: issue.fields.resolutiondate,
          participants,
          data: { ...metadata, status: "Done" },
        });
      }

      // Status change history
      for (const history of issue.fields.changelog?.histories ?? []) {
        if (new Date(history.created) < since) continue;
        const statusChange = history.items.find((i) => i.field === "status");
        if (!statusChange) continue;

        events.push({
          id: `jira-transition-${history.id}`,
          source: "jira",
          type: "issue_updated",
          timestamp: history.created,
          participants: [jiraUserToParticipant(history.author)],
          data: {
            ...metadata,
            fromStatus: statusChange.fromString,
            toStatus: statusChange.toString,
          },
        });
      }

      // Comments
      for (const comment of issue.fields.comment?.comments ?? []) {
        if (new Date(comment.created) < since) continue;
        const bodyText = typeof comment.body === "string"
          ? comment.body
          : JSON.stringify(comment.body).slice(0, 500);

        events.push({
          id: `jira-comment-${comment.id}`,
          source: "jira",
          type: "comment_added",
          timestamp: comment.created,
          participants: [jiraUserToParticipant(comment.author)],
          data: { ...metadata, commentBody: bodyText.slice(0, 500) },
        });
      }
    }

    yield events;
  }

  private async fetchIssues(email: string, apiToken: string, domain: string, since: string): Promise<JiraIssue[]> {
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const jql = encodeURIComponent(`updated >= "${since}" ORDER BY updated DESC`);
    const url = `https://${domain}/rest/api/3/search?jql=${jql}&maxResults=${MAX_RESULTS}&expand=changelog&fields=summary,description,status,issuetype,priority,assignee,reporter,created,updated,resolutiondate,labels,project,comment`;

    const response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    }, { fetchFn: this.fetchFn as unknown as (url: string, init?: RequestInit) => Promise<Response> });

    if (!response.ok) {
      throw new Error(`Jira API error: HTTP ${response.status}`);
    }

    const data = await response.json() as { issues: JiraIssue[] };
    return data.issues;
  }
}
