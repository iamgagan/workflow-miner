import type { ConnectorConfig, ConnectorInterface, RawEvent, RawParticipant } from "./types.js";
import { fetchWithRetry } from "./http-utils.js";

interface LinearIssueNode {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: { readonly id: string; readonly name: string };
  readonly assignee?: { readonly id: string; readonly name: string; readonly email: string };
  readonly creator?: { readonly id: string; readonly name: string; readonly email: string };
  readonly labels: { readonly nodes: readonly { readonly id: string; readonly name: string }[] };
  readonly project?: { readonly id: string; readonly name: string };
  readonly cycle?: { readonly id: string; readonly number: number; readonly name?: string };
  readonly priority: number;
  readonly priorityLabel: string;
  readonly comments: {
    readonly nodes: readonly LinearCommentNode[];
  };
  readonly history: {
    readonly nodes: readonly LinearHistoryNode[];
  };
}

interface LinearCommentNode {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly user?: { readonly id: string; readonly name: string; readonly email: string };
}

interface LinearHistoryNode {
  readonly id: string;
  readonly createdAt: string;
  readonly fromState?: { readonly id: string; readonly name: string };
  readonly toState?: { readonly id: string; readonly name: string };
  readonly fromAssignee?: { readonly id: string; readonly name: string };
  readonly toAssignee?: { readonly id: string; readonly name: string };
  readonly actor?: { readonly id: string; readonly name: string };
}

interface LinearPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface LinearIssuesResponse {
  readonly data: {
    readonly issues: {
      readonly nodes: readonly LinearIssueNode[];
      readonly pageInfo: LinearPageInfo;
    };
  };
}

const ISSUES_QUERY = `
query ($after: String, $updatedAfter: DateTime!) {
  issues(
    first: 50
    after: $after
    filter: { updatedAt: { gte: $updatedAfter } }
    orderBy: updatedAt
  ) {
    nodes {
      id
      identifier
      title
      description
      createdAt
      updatedAt
      state { id name }
      assignee { id name email }
      creator { id name email }
      labels { nodes { id name } }
      project { id name }
      cycle { id number name }
      priority
      priorityLabel
      comments {
        nodes {
          id
          body
          createdAt
          user { id name email }
        }
      }
      history {
        nodes {
          id
          createdAt
          fromState { id name }
          toState { id name }
          fromAssignee { id name }
          toAssignee { id name }
          actor { id name }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

interface FetchFn {
  (url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

export class LinearConnector implements ConnectorInterface {
  readonly source = "linear";

  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  async fetchEvents(config: ConnectorConfig): Promise<readonly RawEvent[]> {
    const apiKey = config.credentials["LINEAR_API_KEY"];
    if (!apiKey) {
      throw new Error("Missing LINEAR_API_KEY in credentials");
    }

    const updatedAfter = new Date();
    updatedAfter.setDate(updatedAfter.getDate() - config.lookbackDays);

    const issues = await this.fetchAllIssues(updatedAfter, apiKey);
    return issues.flatMap((issue) => this.issueToRawEvents(issue));
  }

  private async fetchAllIssues(updatedAfter: Date, apiKey: string): Promise<readonly LinearIssueNode[]> {
    const allIssues: LinearIssueNode[] = [];
    let cursor: string | null = null;

    do {
      const response = await this.graphql(apiKey, ISSUES_QUERY, {
        after: cursor,
        updatedAfter: updatedAfter.toISOString(),
      });

      const body = response as LinearIssuesResponse;
      const { nodes, pageInfo } = body.data.issues;
      allIssues.push(...nodes);
      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (cursor !== null);

    return allIssues;
  }

  private async graphql(apiKey: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
    const response = await fetchWithRetry("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    }, { fetchFn: this.fetchFn as unknown as (url: string, init?: RequestInit) => Promise<Response> });

    if (!response.ok) {
      throw new Error(`Linear API error: HTTP ${response.status}`);
    }

    const body = await response.json() as {
      data?: unknown;
      errors?: readonly { message: string }[];
    };

    if (body.errors && body.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${body.errors[0].message}`);
    }

    if (!body.data) {
      throw new Error("Linear GraphQL response missing data field");
    }

    return body;
  }

  private issueToRawEvents(issue: LinearIssueNode): readonly RawEvent[] {
    const events: RawEvent[] = [];
    const metadata = this.buildIssueMetadata(issue);

    // issue_created event
    events.push({
      id: `linear-issue-${issue.id}`,
      source: "linear",
      type: "issue_created",
      timestamp: issue.createdAt,
      participants: this.buildIssueParticipants(issue),
      data: {
        ...metadata,
        title: issue.title,
        description: issue.description ?? "",
        state: issue.state.name,
      },
    });

    // State change history → issue_updated events
    for (const entry of issue.history.nodes) {
      if (entry.fromState && entry.toState) {
        const participants: RawParticipant[] = [
          { id: issue.id, name: issue.identifier, type: "issue" },
        ];
        if (entry.actor) {
          participants.push({ id: entry.actor.id, name: entry.actor.name, type: "person" });
        }

        events.push({
          id: `linear-history-${entry.id}`,
          source: "linear",
          type: "issue_updated",
          timestamp: entry.createdAt,
          participants,
          data: {
            ...metadata,
            changeType: "state",
            fromState: entry.fromState.name,
            toState: entry.toState.name,
            title: issue.title,
          },
        });
      }

      // Assignee changes → followup_assigned events
      if (entry.toAssignee && (!entry.fromAssignee || entry.fromAssignee.id !== entry.toAssignee.id)) {
        const participants: RawParticipant[] = [
          { id: issue.id, name: issue.identifier, type: "issue" },
          { id: entry.toAssignee.id, name: entry.toAssignee.name, type: "person" },
        ];
        if (entry.actor && entry.actor.id !== entry.toAssignee.id) {
          participants.push({ id: entry.actor.id, name: entry.actor.name, type: "person" });
        }

        events.push({
          id: `linear-assign-${entry.id}`,
          source: "linear",
          type: "followup_assigned",
          timestamp: entry.createdAt,
          participants,
          data: {
            ...metadata,
            title: issue.title,
            assignee: entry.toAssignee.name,
            previousAssignee: entry.fromAssignee?.name ?? null,
          },
        });
      }
    }

    // Comments → message_sent events
    for (const comment of issue.comments.nodes) {
      const participants: RawParticipant[] = [
        { id: issue.id, name: issue.identifier, type: "issue" },
      ];
      if (comment.user) {
        participants.push({ id: comment.user.id, name: comment.user.name, type: "person" });
      }

      events.push({
        id: `linear-comment-${comment.id}`,
        source: "linear",
        type: "message_sent",
        timestamp: comment.createdAt,
        participants,
        data: {
          ...metadata,
          title: issue.title,
          body: comment.body,
        },
      });
    }

    return events;
  }

  private buildIssueMetadata(issue: LinearIssueNode): Readonly<Record<string, unknown>> {
    return {
      issueId: issue.id,
      identifier: issue.identifier,
      priority: issue.priority,
      priorityLabel: issue.priorityLabel,
      labels: issue.labels.nodes.map((l) => l.name),
      project: issue.project?.name ?? null,
      cycle: issue.cycle ? { number: issue.cycle.number, name: issue.cycle.name ?? null } : null,
    };
  }

  private buildIssueParticipants(issue: LinearIssueNode): readonly RawParticipant[] {
    const participants: RawParticipant[] = [
      { id: issue.id, name: issue.identifier, type: "issue" },
    ];
    if (issue.creator) {
      participants.push({ id: issue.creator.id, name: issue.creator.name, type: "person" });
    }
    if (issue.assignee && issue.assignee.id !== issue.creator?.id) {
      participants.push({ id: issue.assignee.id, name: issue.assignee.name, type: "person" });
    }
    return participants;
  }
}
