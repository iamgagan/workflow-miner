import type {
  ConnectorConfig,
  ConnectorInterface,
  RawEvent,
  RawParticipant,
} from "./types.js";
import { fetchWithRetry } from "./http-utils.js";

// Slack API response types (minimal subset we use)
interface SlackMessage {
  readonly ts: string;
  readonly user?: string;
  readonly text: string;
  readonly thread_ts?: string;
  readonly reply_count?: number;
  readonly reactions?: readonly SlackReaction[];
  readonly files?: readonly SlackFile[];
}

interface SlackReaction {
  readonly name: string;
  readonly count: number;
  readonly users: readonly string[];
}

interface SlackFile {
  readonly id: string;
  readonly name: string;
  readonly url_private?: string;
  readonly mimetype?: string;
}

interface SlackUser {
  readonly id: string;
  readonly name: string;
  readonly real_name?: string;
  readonly profile?: { readonly display_name?: string };
}

interface SlackApiResponse<T> {
  readonly ok: boolean;
  readonly error?: string;
  readonly response_metadata?: {
    readonly next_cursor?: string;
  };
  readonly messages?: readonly T[];
  readonly members?: readonly T[];
}

export interface SlackFetcher {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

const DECISION_REACTIONS = new Set([
  "white_check_mark",
  "heavy_check_mark",
  "check",
  "+1",
  "thumbsup",
]);

const DECISION_PATTERNS = [
  /\bdecision\s*:/i,
  /\bagreed\b/i,
  /\blet'?s\s+(go\s+with|do|use|ship|move\s+forward)\b/i,
  /\bdecided\s+to\b/i,
  /\bfinal\s+call\b/i,
];

const FOLLOWUP_PATTERNS = [
  /\bcan\s+you\b/i,
  /\bplease\s+(handle|take|do|update|review|send|create|fix)\b/i,
  /\baction\s+item\b/i,
  /\bfollow\s*up\b/i,
  /\btodo\b/i,
  /\bowner\s*:/i,
  /\bassigned?\s+to\b/i,
];

const URL_PATTERN = /https?:\/\/[^\s>]+/g;

function tsToDate(ts: string): Date {
  return new Date(parseFloat(ts) * 1000);
}

function hasDecisionReaction(message: SlackMessage): boolean {
  if (!message.reactions) return false;
  return message.reactions.some((r) => DECISION_REACTIONS.has(r.name));
}

function matchesDecisionPattern(text: string): boolean {
  return DECISION_PATTERNS.some((p) => p.test(text));
}

function matchesFollowupPattern(text: string): boolean {
  return FOLLOWUP_PATTERNS.some((p) => p.test(text));
}

function hasMention(text: string): boolean {
  return /<@U[A-Z0-9]+>/.test(text);
}

function extractUrls(text: string): readonly string[] {
  const matches = text.match(URL_PATTERN);
  return matches ?? [];
}

function hasFiles(message: SlackMessage): boolean {
  return (message.files?.length ?? 0) > 0;
}

function classifyMessage(message: SlackMessage): string {
  if (hasDecisionReaction(message) || matchesDecisionPattern(message.text)) {
    return "decision_made";
  }
  if (hasMention(message.text) && matchesFollowupPattern(message.text)) {
    return "followup_assigned";
  }
  if (hasFiles(message) || extractUrls(message.text).length > 0) {
    return "artifact_shared";
  }
  return "message_sent";
}

function resolveUserName(user: SlackUser): string {
  return (
    user.profile?.display_name || user.real_name || user.name || user.id
  );
}

export class SlackConnector implements ConnectorInterface {
  readonly source = "slack";

  private readonly fetcher: SlackFetcher;

  constructor(fetcher?: SlackFetcher) {
    this.fetcher = fetcher ?? { fetch: globalThis.fetch.bind(globalThis) };
  }

  async *fetchEvents(
    config: ConnectorConfig,
  ): AsyncIterable<readonly RawEvent[]> {
    const token = config.credentials["SLACK_BOT_TOKEN"];
    if (!token) {
      throw new Error("Missing SLACK_BOT_TOKEN in credentials");
    }

    const channelIds = config.credentials["SLACK_CHANNEL_IDS"];
    if (!channelIds) {
      throw new Error("Missing SLACK_CHANNEL_IDS in credentials");
    }

    const channels = channelIds.split(",").map((c) => c.trim()).filter(Boolean);
    if (channels.length === 0) {
      throw new Error("SLACK_CHANNEL_IDS contains no valid channel IDs");
    }
    const userMap = await this.fetchUsers(token);
    const oldest = this.computeOldest(config.lookbackDays);

    for (const channel of channels) {
      const channelEvents: RawEvent[] = [];
      const messages = await this.fetchChannelMessages(token, channel, oldest);
      for (const msg of messages) {
        const events = this.messageToRawEvents(msg, channel, userMap);
        channelEvents.push(...events);

        if (msg.thread_ts === msg.ts && (msg.reply_count ?? 0) > 0) {
          const replies = await this.fetchThreadReplies(
            token,
            channel,
            msg.ts,
          );
          for (const reply of replies) {
            if (reply.ts === msg.ts) continue;
            const replyEvents = this.messageToRawEvents(
              reply,
              channel,
              userMap,
            );
            channelEvents.push(...replyEvents);
          }
        }
      }
      yield channelEvents;
    }
  }

  private messageToRawEvents(
    msg: SlackMessage,
    channel: string,
    userMap: ReadonlyMap<string, SlackUser>,
  ): readonly RawEvent[] {
    const eventType = classifyMessage(msg);
    const user = msg.user ? userMap.get(msg.user) : undefined;
    const participants: RawParticipant[] = [];

    if (user) {
      participants.push({
        id: user.id,
        name: resolveUserName(user),
        type: "person",
      });
    }

    participants.push({
      id: channel,
      name: channel,
      type: "channel",
    });

    // Extract mentioned users as participants
    const mentionPattern = /<@(U[A-Z0-9]+)>/g;
    let match: RegExpExecArray | null;
    while ((match = mentionPattern.exec(msg.text)) !== null) {
      const mentionedId = match[1];
      if (mentionedId !== msg.user) {
        const mentioned = userMap.get(mentionedId);
        participants.push({
          id: mentionedId,
          name: mentioned ? resolveUserName(mentioned) : mentionedId,
          type: "person",
        });
      }
    }

    const data: Record<string, unknown> = {
      text: msg.text,
      threadTs: msg.thread_ts,
    };

    if (msg.reactions) {
      data["reactions"] = msg.reactions.map((r) => ({
        name: r.name,
        count: r.count,
      }));
    }

    if (msg.files) {
      data["files"] = msg.files.map((f) => ({
        id: f.id,
        name: f.name,
        mimetype: f.mimetype,
      }));
    }

    const urls = extractUrls(msg.text);
    if (urls.length > 0) {
      data["urls"] = urls;
    }

    return [
      {
        id: `slack-${channel}-${msg.ts}`,
        source: "slack",
        type: eventType,
        timestamp: tsToDate(msg.ts),
        participants,
        data,
      },
    ];
  }

  private computeOldest(lookbackDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() - lookbackDays);
    return String(d.getTime() / 1000);
  }

  private async fetchUsers(
    token: string,
  ): Promise<ReadonlyMap<string, SlackUser>> {
    const users = new Map<string, SlackUser>();
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ limit: "200" });
      if (cursor) params.set("cursor", cursor);

      const resp = await this.apiCall<SlackUser>(
        token,
        "users.list",
        params,
        "members",
      );

      for (const user of resp.items) {
        users.set(user.id, user);
      }
      cursor = resp.nextCursor;
    } while (cursor);

    return users;
  }

  private async fetchChannelMessages(
    token: string,
    channel: string,
    oldest: string,
  ): Promise<readonly SlackMessage[]> {
    const allMessages: SlackMessage[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        channel,
        oldest,
        limit: "200",
        inclusive: "true",
      });
      if (cursor) params.set("cursor", cursor);

      const resp = await this.apiCall<SlackMessage>(
        token,
        "conversations.history",
        params,
        "messages",
      );

      allMessages.push(...resp.items);
      cursor = resp.nextCursor;
    } while (cursor);

    return allMessages;
  }

  private async fetchThreadReplies(
    token: string,
    channel: string,
    threadTs: string,
  ): Promise<readonly SlackMessage[]> {
    const allReplies: SlackMessage[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        channel,
        ts: threadTs,
        limit: "200",
        inclusive: "true",
      });
      if (cursor) params.set("cursor", cursor);

      const resp = await this.apiCall<SlackMessage>(
        token,
        "conversations.replies",
        params,
        "messages",
      );

      allReplies.push(...resp.items);
      cursor = resp.nextCursor;
    } while (cursor);

    return allReplies;
  }

  private async apiCall<T>(
    token: string,
    method: string,
    params: URLSearchParams,
    listKey: "messages" | "members",
  ): Promise<{ readonly items: readonly T[]; readonly nextCursor?: string }> {
    const url = `https://slack.com/api/${method}?${params.toString()}`;
    const resp = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
    }, { fetchFn: this.fetcher.fetch.bind(this.fetcher) });

    if (!resp.ok) {
      throw new Error(`Slack API HTTP error: ${resp.status} ${resp.statusText}`);
    }

    const body = (await resp.json()) as SlackApiResponse<T>;
    if (!body.ok) {
      throw new Error(`Slack API error: ${body.error ?? "unknown"}`);
    }

    const items = (body[listKey] as readonly T[] | undefined) ?? [];
    const nextCursor = body.response_metadata?.next_cursor || undefined;

    return { items, nextCursor };
  }
}
