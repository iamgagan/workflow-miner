import { describe, it, expect, vi } from "vitest";
import { NotionConnector } from "./notion.js";
import { getAllEvents, type ConnectorConfig } from "./types.js";

function mockNotionPage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-abc-123",
    created_time: "2026-04-10T10:00:00Z",
    last_edited_time: "2026-04-10T10:00:00Z",
    created_by: { id: "user-1", name: "Alice", type: "person" },
    last_edited_by: { id: "user-1", name: "Alice", type: "person" },
    parent: { type: "workspace", workspace: true },
    url: "https://notion.so/page-abc-123",
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: "Sprint Planning" }],
      },
    },
    ...overrides,
  };
}

function makeFetchFn(pages: unknown[], hasMore = false, nextCursor?: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ results: pages, has_more: hasMore, next_cursor: nextCursor }),
  });
}

const baseConfig: ConnectorConfig = {
  credentials: { NOTION_TOKEN: "ntn_test_key" },
  lookbackDays: 7,
};

describe("NotionConnector", () => {
  it("implements ConnectorInterface with source 'notion'", () => {
    const connector = new NotionConnector();
    expect(connector.source).toBe("notion");
  });

  it("throws when NOTION_TOKEN is missing", async () => {
    const connector = new NotionConnector();
    await expect(
      getAllEvents(connector, { credentials: {}, lookbackDays: 7 }),
    ).rejects.toThrow("Missing NOTION_TOKEN in credentials");
  });

  it("fetches pages and creates doc_created events for recent pages", async () => {
    const page = mockNotionPage();
    const fetchFn = makeFetchFn([page]);
    const connector = new NotionConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/search");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer ntn_test_key");
    expect(init.headers["Notion-Version"]).toBe("2022-06-28");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        id: "notion-page-page-abc-123",
        source: "notion",
        type: "doc_created",
      }),
    );
    expect(events[0].data).toEqual(
      expect.objectContaining({
        title: "Sprint Planning",
        url: "https://notion.so/page-abc-123",
        pageId: "page-abc-123",
      }),
    );
  });

  it("classifies old-but-edited pages as doc_updated", async () => {
    const page = mockNotionPage({
      created_time: "2020-01-01T00:00:00Z", // way outside lookback
      last_edited_time: new Date().toISOString(), // edited today
      last_edited_by: { id: "user-2", name: "Bob", type: "person" },
    });
    const fetchFn = makeFetchFn([page]);
    const connector = new NotionConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("doc_updated");
  });

  it("extracts title from title-type property", async () => {
    const page = mockNotionPage({
      properties: {
        Title: {
          type: "title",
          title: [{ plain_text: "My " }, { plain_text: "Doc" }],
        },
      },
    });
    const fetchFn = makeFetchFn([page]);
    const connector = new NotionConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events[0].data.title).toBe("My Doc");
  });

  it("falls back to 'Untitled' when no title property exists", async () => {
    const page = mockNotionPage({
      properties: {
        Status: { type: "select" },
      },
    });
    const fetchFn = makeFetchFn([page]);
    const connector = new NotionConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events[0].data.title).toBe("Untitled");
  });

  it("adds distinct participants when creator and last editor differ", async () => {
    const page = mockNotionPage({
      created_by: { id: "user-1", name: "Alice", type: "person" },
      last_edited_by: { id: "user-2", name: "Bob", type: "person" },
    });
    const fetchFn = makeFetchFn([page]);
    const connector = new NotionConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    const personParticipants = events[0].participants.filter((p) => p.type === "person");
    expect(personParticipants).toHaveLength(2);
    expect(personParticipants.map((p) => p.id).sort()).toEqual(["user-1", "user-2"]);
  });

  it("stops pagination when encountering pages older than lookback window", async () => {
    const recentTimestamp = new Date().toISOString();
    const recent = mockNotionPage({
      id: "recent",
      created_time: recentTimestamp,
      last_edited_time: recentTimestamp, // same → no separate update event
    });
    const old = mockNotionPage({
      id: "old",
      created_time: "2020-01-01T00:00:00Z",
      last_edited_time: "2020-01-01T00:00:00Z",
    });

    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ results: [recent, old], has_more: true, next_cursor: "c1" }),
    });

    const connector = new NotionConnector(fetchFn);
    const events = await getAllEvents(connector, baseConfig);

    // Only the recent page, and no second fetch
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(events.map((e) => e.data.pageId)).toEqual(["recent"]);
  });

  it("paginates through multiple pages via cursor", async () => {
    const page1 = mockNotionPage({ id: "p1" });
    const page2 = mockNotionPage({ id: "p2" });

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [page1], has_more: true, next_cursor: "cursor-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [page2], has_more: false }),
      });

    const connector = new NotionConnector(fetchFn);
    const events = await getAllEvents(connector, baseConfig);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(secondBody.start_cursor).toBe("cursor-1");
    expect(events.map((e) => e.data.pageId)).toEqual(["p1", "p2"]);
  });

  it("throws on API errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    });

    const connector = new NotionConnector(fetchFn);
    await expect(getAllEvents(connector, baseConfig)).rejects.toThrow("Notion API error: HTTP 401");
  });
});
