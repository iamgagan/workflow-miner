import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackConnector, type SlackFetcher } from "./slack.js";
import type { ConnectorConfig } from "./types.js";

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeConfig(overrides?: Partial<ConnectorConfig>): ConnectorConfig {
  return {
    credentials: {
      SLACK_BOT_TOKEN: "xoxb-test-token",
      SLACK_CHANNEL_IDS: "C123",
    },
    lookbackDays: 7,
    ...overrides,
  };
}

function makeFetcher(responses: Record<string, unknown>): SlackFetcher {
  return {
    fetch: vi.fn(async (url: string) => {
      for (const [key, body] of Object.entries(responses)) {
        if (url.includes(key)) {
          return mockResponse(body);
        }
      }
      return mockResponse({ ok: true, messages: [], members: [] });
    }),
  };
}

const BASIC_USERS_RESPONSE = {
  ok: true,
  members: [
    {
      id: "U001",
      name: "alice",
      real_name: "Alice Smith",
      profile: { display_name: "alice" },
    },
    {
      id: "U002",
      name: "bob",
      real_name: "Bob Jones",
      profile: { display_name: "bob" },
    },
  ],
};

describe("SlackConnector", () => {
  let connector: SlackConnector;
  let fetcher: SlackFetcher;

  describe("fetchEvents", () => {
    it("throws if SLACK_BOT_TOKEN is missing", async () => {
      connector = new SlackConnector();
      const config = makeConfig({
        credentials: { SLACK_CHANNEL_IDS: "C123" },
      });
      await expect(connector.fetchEvents(config)).rejects.toThrow(
        "Missing SLACK_BOT_TOKEN",
      );
    });

    it("throws if SLACK_CHANNEL_IDS is missing", async () => {
      connector = new SlackConnector();
      const config = makeConfig({
        credentials: { SLACK_BOT_TOKEN: "xoxb-test" },
      });
      await expect(connector.fetchEvents(config)).rejects.toThrow(
        "Missing SLACK_CHANNEL_IDS",
      );
    });

    it("fetches messages from a channel and returns RawEvents", async () => {
      fetcher = makeFetcher({
        "users.list": BASIC_USERS_RESPONSE,
        "conversations.history": {
          ok: true,
          messages: [
            {
              ts: "1700000000.000001",
              user: "U001",
              text: "Hello team!",
            },
          ],
        },
      });
      connector = new SlackConnector(fetcher);

      const events = await connector.fetchEvents(makeConfig());
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: "slack-C123-1700000000.000001",
        source: "slack",
        type: "message_sent",
        data: { text: "Hello team!" },
      });
      expect(events[0].participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "U001", name: "alice", type: "person" }),
          expect.objectContaining({ id: "C123", type: "channel" }),
        ]),
      );
    });

    it("converts Slack timestamps to Date objects", async () => {
      fetcher = makeFetcher({
        "users.list": BASIC_USERS_RESPONSE,
        "conversations.history": {
          ok: true,
          messages: [
            { ts: "1700000000.000000", user: "U001", text: "test" },
          ],
        },
      });
      connector = new SlackConnector(fetcher);

      const events = await connector.fetchEvents(makeConfig());
      expect(events[0].timestamp).toEqual(new Date(1700000000 * 1000));
    });
  });

  describe("decision detection", () => {
    it("detects decision_made from reactions", async () => {
      fetcher = makeFetcher({
        "users.list": BASIC_USERS_RESPONSE,
        "conversations.history": {
          ok: true,
          messages: [
            {
              ts: "1700000001.000000",
              user: "U001",
              text: "Let's use PostgreSQL for this",
              reactions: [
                { name: "white_check_mark", count: 3, users: ["U001", "U002", "U003"] },
              ],
            },
          ],
        },
      });
      connector = new SlackConnector(fetcher);

      const events = await connector.fetchEvents(makeConfig());
      expect(events[0].type).toBe("decision_made");
    });

    it("detects decision_made from text patterns", async () => {
      const testCases = [
        "Decision: we're going with option A",
        "Agreed, let's do that",
        "Let's go with the monorepo approach",
        "We decided to use TypeScript",
        "Final call: ship it Friday",
      ];

      for (const text of testCases) {
        fetcher = makeFetcher({
          "users.list": BASIC_USERS_RESPONSE,
          "conversations.history": {
            ok: true,
            messages: [{ ts: "1700000001.000000", user: "U001", text }],
          },
        });
        connector = new SlackConnector(fetcher);

        const events = await connector.fetchEvents(makeConfig());
        expect(events[0].type).toBe("decision_made");
      }
    });
  });

  describe("followup detection", () => {
    it("detects followup_assigned when mention + action language", async () => {
      fetcher = makeFetcher({
        "users.list": BASIC_USERS_RESPONSE,
        "conversations.history": {
          ok: true,
          messages: [
            {
              ts: "1700000002.000000",
              user: "U001",
              text: "<@U002> can you review the PR?",
            },
          ],
        },
      });
      connector = new SlackConnector(fetcher);

      const events = await connector.fetchEvents(makeConfig());
      expect(events[0].type).toBe("followup_assigned");
      expect(events[0].participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "U002", name: "bob", type: "person" }),
        ]),
      );
    });

    it("does not detect followup without mention", async () => {
      fetcher = makeFetcher({
        "users.list": BASIC_USERS_RESPONSE,
        "conversations.history": {
          ok: true,
          messages: [
            {
              ts: "1700000002.000000",
              user: "U001",
              text: "Can you review the PR?",
            },
          ],
        },
      });
      connector = new SlackConnector(fetcher);

      const events = await connector.fetchEvents(makeConfig());
      expect(events[0].type).toBe("message_sent");
    });
  });

  describe("artifact detection", () => {
    it("detects artifact_shared when message has URLs", async () => {
      fetcher = makeFetcher({
        "users.list": BASIC_USERS_RESPONSE,
        "conversations.history": {
          ok: true,
          messages: [
            {
              ts: "1700000003.000000",
              user: "U001",
              text: "Check out https://docs.google.com/document/d/123",
            },
          ],
        },
      });
      connector = new SlackConnector(fetcher);

      const events = await connector.fetchEvents(makeConfig());
      expect(events[0].type).toBe("artifact_shared");
      expect(events[0].data).toHaveProperty("urls");
    });

    it("detects artifact_shared when message has files", async () => {
      fetcher = makeFetcher({
        "users.list": BASIC_USERS_RESPONSE,
        "conversations.history": {
          ok: true,
          messages: [
            {
              ts: "1700000004.000000",
              user: "U001",
              text: "Here's the spec",
              files: [
                { id: "F001", name: "spec.pdf", mimetype: "application/pdf" },
              ],
            },
          ],
        },
      });
      connector = new SlackConnector(fetcher);

      const events = await connector.fetchEvents(makeConfig());
      expect(events[0].type).toBe("artifact_shared");
      expect(events[0].data).toHaveProperty("files");
    });
  });

  describe("thread replies", () => {
    it("fetches thread replies for messages with replies", async () => {
      fetcher = makeFetcher({
        "users.list": BASIC_USERS_RESPONSE,
        "conversations.history": {
          ok: true,
          messages: [
            {
              ts: "1700000005.000000",
              thread_ts: "1700000005.000000",
              user: "U001",
              text: "Thread parent",
              reply_count: 1,
            },
          ],
        },
        "conversations.replies": {
          ok: true,
          messages: [
            {
              ts: "1700000005.000000",
              thread_ts: "1700000005.000000",
              user: "U001",
              text: "Thread parent",
            },
            {
              ts: "1700000006.000000",
              thread_ts: "1700000005.000000",
              user: "U002",
              text: "Thread reply",
            },
          ],
        },
      });
      connector = new SlackConnector(fetcher);

      const events = await connector.fetchEvents(makeConfig());
      expect(events).toHaveLength(2);
      expect(events[0].id).toBe("slack-C123-1700000005.000000");
      expect(events[1].id).toBe("slack-C123-1700000006.000000");
      expect(events[1].data).toMatchObject({
        text: "Thread reply",
        threadTs: "1700000005.000000",
      });
    });

    it("skips thread fetch for messages without replies", async () => {
      const fetchFn = vi.fn(async (url: string) => {
        if (url.includes("users.list")) return mockResponse(BASIC_USERS_RESPONSE);
        if (url.includes("conversations.history")) {
          return mockResponse({
            ok: true,
            messages: [
              { ts: "1700000005.000000", user: "U001", text: "No thread" },
            ],
          });
        }
        return mockResponse({ ok: true, messages: [] });
      });

      connector = new SlackConnector({ fetch: fetchFn });
      await connector.fetchEvents(makeConfig());

      const calls = fetchFn.mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => u.includes("conversations.replies"))).toBe(false);
    });
  });

  describe("pagination", () => {
    it("handles cursor-based pagination for messages", async () => {
      const fetchFn = vi.fn(async (url: string) => {
        if (url.includes("users.list")) return mockResponse(BASIC_USERS_RESPONSE);
        if (url.includes("conversations.history")) {
          if (!url.includes("cursor=")) {
            return mockResponse({
              ok: true,
              messages: [
                { ts: "1700000001.000000", user: "U001", text: "Page 1" },
              ],
              response_metadata: { next_cursor: "page2cursor" },
            });
          }
          return mockResponse({
            ok: true,
            messages: [
              { ts: "1700000002.000000", user: "U001", text: "Page 2" },
            ],
          });
        }
        return mockResponse({ ok: true, messages: [] });
      });

      connector = new SlackConnector({ fetch: fetchFn });
      const events = await connector.fetchEvents(makeConfig());

      expect(events).toHaveLength(2);
      expect(events[0].data).toMatchObject({ text: "Page 1" });
      expect(events[1].data).toMatchObject({ text: "Page 2" });
    });

    it("handles cursor-based pagination for users", async () => {
      const fetchFn = vi.fn(async (url: string) => {
        if (url.includes("users.list")) {
          if (!url.includes("cursor=")) {
            return mockResponse({
              ok: true,
              members: [{ id: "U001", name: "alice", real_name: "Alice" }],
              response_metadata: { next_cursor: "usercursor2" },
            });
          }
          return mockResponse({
            ok: true,
            members: [{ id: "U002", name: "bob", real_name: "Bob" }],
          });
        }
        if (url.includes("conversations.history")) {
          return mockResponse({
            ok: true,
            messages: [
              { ts: "1700000001.000000", user: "U002", text: "From bob" },
            ],
          });
        }
        return mockResponse({ ok: true, messages: [] });
      });

      connector = new SlackConnector({ fetch: fetchFn });
      const events = await connector.fetchEvents(makeConfig());

      expect(events[0].participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "U002", name: "Bob" }),
        ]),
      );
    });
  });

  describe("multiple channels", () => {
    it("fetches messages from all configured channels", async () => {
      const fetchFn = vi.fn(async (url: string) => {
        if (url.includes("users.list")) return mockResponse(BASIC_USERS_RESPONSE);
        if (url.includes("conversations.history")) {
          if (url.includes("channel=C123")) {
            return mockResponse({
              ok: true,
              messages: [
                { ts: "1700000001.000000", user: "U001", text: "In C123" },
              ],
            });
          }
          if (url.includes("channel=C456")) {
            return mockResponse({
              ok: true,
              messages: [
                { ts: "1700000002.000000", user: "U002", text: "In C456" },
              ],
            });
          }
        }
        return mockResponse({ ok: true, messages: [] });
      });

      connector = new SlackConnector({ fetch: fetchFn });
      const config = makeConfig({
        credentials: {
          SLACK_BOT_TOKEN: "xoxb-test",
          SLACK_CHANNEL_IDS: "C123, C456",
        },
      });
      const events = await connector.fetchEvents(config);

      expect(events).toHaveLength(2);
      expect(events[0].id).toContain("C123");
      expect(events[1].id).toContain("C456");
    });
  });

  describe("error handling", () => {
    it("throws on HTTP errors", async () => {
      fetcher = {
        fetch: vi.fn(async () => ({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        })) as unknown as SlackFetcher["fetch"],
      };
      connector = new SlackConnector(fetcher);

      await expect(connector.fetchEvents(makeConfig())).rejects.toThrow(
        "Slack API HTTP error: 401",
      );
    });

    it("throws on Slack API errors", async () => {
      fetcher = makeFetcher({
        "users.list": { ok: false, error: "invalid_auth" },
      });
      connector = new SlackConnector(fetcher);

      await expect(connector.fetchEvents(makeConfig())).rejects.toThrow(
        "Slack API error: invalid_auth",
      );
    });
  });

  describe("source property", () => {
    it('returns "slack"', () => {
      connector = new SlackConnector();
      expect(connector.source).toBe("slack");
    });
  });
});
