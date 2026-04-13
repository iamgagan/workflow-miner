import type { ConnectorConfig, ConnectorInterface, RawEvent, RawParticipant } from "./types.js";
import { fetchWithRetry } from "./http-utils.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const PAGE_SIZE = 100;

interface NotionUser {
  readonly id: string;
  readonly name?: string;
  readonly type: string;
}

interface NotionPage {
  readonly id: string;
  readonly created_time: string;
  readonly last_edited_time: string;
  readonly created_by: NotionUser;
  readonly last_edited_by: NotionUser;
  readonly parent: Record<string, unknown>;
  readonly url: string;
  readonly properties: Record<string, { type: string; title?: readonly { plain_text: string }[] }>;
}

interface FetchFn {
  (url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

function extractTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title" && prop.title) {
      return prop.title.map((t) => t.plain_text).join("") || "Untitled";
    }
  }
  return "Untitled";
}

function notionUserToParticipant(user: NotionUser): RawParticipant {
  return { id: user.id, name: user.name ?? user.id, type: "person" };
}

export class NotionConnector implements ConnectorInterface {
  readonly source = "notion";

  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  async fetchEvents(config: ConnectorConfig): Promise<readonly RawEvent[]> {
    const token = config.credentials["NOTION_TOKEN"];
    if (!token) throw new Error("Missing NOTION_TOKEN in credentials");

    const since = new Date();
    since.setDate(since.getDate() - config.lookbackDays);

    const pages = await this.searchRecentPages(token, since);
    const events: RawEvent[] = [];

    for (const page of pages) {
      const title = extractTitle(page);
      const created = new Date(page.created_time);
      const edited = new Date(page.last_edited_time);

      events.push({
        id: `notion-page-${page.id}`,
        source: "notion",
        type: created >= since ? "doc_created" : "doc_updated",
        timestamp: created >= since ? page.created_time : page.last_edited_time,
        participants: [
          notionUserToParticipant(page.created_by),
          ...(page.last_edited_by.id !== page.created_by.id
            ? [notionUserToParticipant(page.last_edited_by)]
            : []),
        ],
        data: {
          title,
          url: page.url,
          pageId: page.id,
          createdAt: page.created_time,
          lastEditedAt: page.last_edited_time,
        },
      });

      // If edited significantly after creation, add a separate update event
      if (edited.getTime() - created.getTime() > 60_000 && edited >= since && created >= since) {
        events.push({
          id: `notion-edit-${page.id}`,
          source: "notion",
          type: "doc_updated",
          timestamp: page.last_edited_time,
          participants: [notionUserToParticipant(page.last_edited_by)],
          data: { title, url: page.url, pageId: page.id },
        });
      }
    }

    return events;
  }

  private async searchRecentPages(token: string, since: Date): Promise<NotionPage[]> {
    const allPages: NotionPage[] = [];
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = {
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: PAGE_SIZE,
      };
      if (cursor) body.start_cursor = cursor;

      const response = await fetchWithRetry(`${NOTION_API}/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }, { fetchFn: this.fetchFn as unknown as (url: string, init?: RequestInit) => Promise<Response> });

      if (!response.ok) {
        throw new Error(`Notion API error: HTTP ${response.status}`);
      }

      const data = await response.json() as {
        results: NotionPage[];
        has_more: boolean;
        next_cursor?: string;
      };

      // Stop when we hit pages older than the lookback window
      for (const page of data.results) {
        if (new Date(page.last_edited_time) < since) {
          return allPages;
        }
        allPages.push(page);
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return allPages;
  }
}
