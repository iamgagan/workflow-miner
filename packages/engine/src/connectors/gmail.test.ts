import { describe, it, expect, vi, beforeEach } from "vitest";
import { GmailConnector } from "./gmail.js";
import type { ConnectorConfig } from "./types.js";

function makeHeader(name: string, value: string) {
  return { name, value };
}

function makeMessage(overrides: {
  id: string;
  threadId: string;
  internalDate?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  labelIds?: string[];
}) {
  const body = overrides.body ?? "Hello world";
  return {
    id: overrides.id,
    threadId: overrides.threadId,
    internalDate: overrides.internalDate ?? String(Date.now()),
    labelIds: overrides.labelIds ?? ["INBOX"],
    payload: {
      headers: [
        makeHeader("From", overrides.from ?? "alice@example.com"),
        makeHeader("To", overrides.to ?? "bob@example.com"),
        makeHeader("Subject", overrides.subject ?? "Test Subject"),
      ],
      body: {
        data: Buffer.from(body).toString("base64url"),
      },
    },
  };
}

function makeMockGmail(options: {
  threads?: Array<{ id: string }>;
  threadMessages?: Record<string, ReturnType<typeof makeMessage>[]>;
  nextPageToken?: string;
}) {
  let callCount = 0;
  return {
    users: {
      threads: {
        list: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1 && options.nextPageToken) {
            return Promise.resolve({
              data: {
                threads: options.threads?.slice(0, 100) ?? [],
                nextPageToken: options.nextPageToken,
              },
            });
          }
          return Promise.resolve({
            data: {
              threads: callCount === 1
                ? (options.threads ?? [])
                : (options.threads?.slice(100) ?? []),
              nextPageToken: undefined,
            },
          });
        }),
        get: vi.fn().mockImplementation(({ id }: { id: string }) => {
          const messages = options.threadMessages?.[id] ?? [];
          return Promise.resolve({
            data: { id, messages },
          });
        }),
      },
    },
  };
}

const baseConfig: ConnectorConfig = {
  credentials: {
    GMAIL_CLIENT_ID: "test-client-id",
    GMAIL_CLIENT_SECRET: "test-client-secret",
    GMAIL_REFRESH_TOKEN: "test-refresh-token",
    GMAIL_USER_EMAIL: "me@example.com",
  },
  lookbackDays: 7,
};

describe("GmailConnector", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-07T12:00:00Z"));
  });

  it("has source set to gmail", () => {
    const connector = new GmailConnector();
    expect(connector.source).toBe("gmail");
  });

  it("throws when credentials are missing", async () => {
    const connector = new GmailConnector();
    await expect(
      connector.fetchEvents({
        credentials: {},
        lookbackDays: 7,
      }),
    ).rejects.toThrow("Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN");
  });

  it("fetches threads and produces RawEvents", async () => {
    const msg = makeMessage({
      id: "msg1",
      threadId: "thread1",
      from: "alice@example.com",
      to: "me@example.com",
      subject: "Hello",
      body: "Hi there",
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread1" }],
      threadMessages: { thread1: [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("gmail-msg1");
    expect(events[0].source).toBe("gmail");
    expect(events[0].type).toBe("message_received");
    expect(events[0].data).toMatchObject({
      threadId: "thread1",
      subject: "Hello",
    });
  });

  it("detects message_sent when from matches user email", async () => {
    const msg = makeMessage({
      id: "msg2",
      threadId: "thread2",
      from: "me@example.com",
      to: "alice@example.com",
      subject: "Reply",
      body: "Sure thing",
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread2" }],
      threadMessages: { thread2: [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events[0].type).toBe("message_sent");
  });

  it("detects decision_made from body content", async () => {
    const msg = makeMessage({
      id: "msg3",
      threadId: "thread3",
      from: "boss@example.com",
      to: "me@example.com",
      subject: "Project Direction",
      body: "We agreed to use TypeScript for the new service.",
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread3" }],
      threadMessages: { thread3: [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events[0].type).toBe("decision_made");
  });

  it("detects followup_assigned from body content", async () => {
    const msg = makeMessage({
      id: "msg4",
      threadId: "thread4",
      from: "lead@example.com",
      to: "me@example.com",
      subject: "Sprint Tasks",
      body: "Action item: Please follow up on the API design review by Friday.",
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread4" }],
      threadMessages: { thread4: [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events[0].type).toBe("followup_assigned");
  });

  it("handles pagination across multiple pages", async () => {
    const page1Threads = Array.from({ length: 3 }, (_, i) => ({
      id: `thread-p1-${i}`,
    }));
    const page2Threads = Array.from({ length: 2 }, (_, i) => ({
      id: `thread-p2-${i}`,
    }));

    const threadMessages: Record<string, ReturnType<typeof makeMessage>[]> = {};
    for (const t of [...page1Threads, ...page2Threads]) {
      threadMessages[t.id] = [
        makeMessage({
          id: `msg-${t.id}`,
          threadId: t.id,
          from: "other@example.com",
          to: "me@example.com",
        }),
      ];
    }

    let callCount = 0;
    const mockGmail = {
      users: {
        threads: {
          list: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                data: { threads: page1Threads, nextPageToken: "page2token" },
              });
            }
            return Promise.resolve({
              data: { threads: page2Threads, nextPageToken: undefined },
            });
          }),
          get: vi.fn().mockImplementation(({ id }: { id: string }) => {
            return Promise.resolve({
              data: { id, messages: threadMessages[id] ?? [] },
            });
          }),
        },
      },
    };

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events).toHaveLength(5);
    expect(mockGmail.users.threads.list).toHaveBeenCalledTimes(2);
  });

  it("extracts participants from From and To headers", async () => {
    const msg = makeMessage({
      id: "msg5",
      threadId: "thread5",
      from: "Alice Smith <alice@example.com>",
      to: "Bob Jones <bob@example.com>",
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread5" }],
      threadMessages: { thread5: [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    const participants = events[0].participants;
    expect(participants).toHaveLength(2);
    expect(participants[0]).toMatchObject({
      id: "alice@example.com",
      name: "Alice Smith",
      type: "person",
    });
    expect(participants[1]).toMatchObject({
      id: "bob@example.com",
      name: "Bob Jones",
      type: "person",
    });
  });

  it("marks reply chains with isReply flag", async () => {
    const msg1 = makeMessage({
      id: "msg6a",
      threadId: "thread6",
      from: "alice@example.com",
      to: "me@example.com",
      subject: "Question",
      body: "What do you think?",
    });
    const msg2 = makeMessage({
      id: "msg6b",
      threadId: "thread6",
      from: "me@example.com",
      to: "alice@example.com",
      subject: "Re: Question",
      body: "Looks good to me",
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread6" }],
      threadMessages: { thread6: [msg1, msg2] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events).toHaveLength(2);
    expect(events[0].data["isReply"]).toBe(true);
    expect(events[1].data["isReply"]).toBe(true);
  });

  it("truncates body preview to 500 chars", async () => {
    const longBody = "x".repeat(1000);
    const msg = makeMessage({
      id: "msg7",
      threadId: "thread7",
      body: longBody,
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread7" }],
      threadMessages: { thread7: [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    const contentText = events[0].data["contentText"] as string;
    expect(contentText.length).toBeLessThanOrEqual(500);
  });

  it("handles empty thread list", async () => {
    const mockGmail = makeMockGmail({ threads: [] });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events).toHaveLength(0);
  });

  it("deduplicates participants with same email", async () => {
    const msg = makeMessage({
      id: "msg8",
      threadId: "thread8",
      from: "alice@example.com",
      to: "alice@example.com",
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread8" }],
      threadMessages: { thread8: [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events[0].participants).toHaveLength(1);
  });

  it("includes label IDs in event data", async () => {
    const msg = makeMessage({
      id: "msg9",
      threadId: "thread9",
      labelIds: ["INBOX", "IMPORTANT", "STARRED"],
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread9" }],
      threadMessages: { thread9: [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events[0].data["labelIds"]).toEqual(["INBOX", "IMPORTANT", "STARRED"]);
  });

  it("extracts body from multipart text/plain", async () => {
    const textBody = "Plain text content here";
    const msg = {
      id: "msg10",
      threadId: "thread10",
      internalDate: String(Date.now()),
      labelIds: ["INBOX"],
      payload: {
        headers: [
          makeHeader("From", "alice@example.com"),
          makeHeader("To", "me@example.com"),
          makeHeader("Subject", "Multipart"),
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: {
              data: Buffer.from(textBody).toString("base64url"),
            },
          },
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from("<p>HTML content</p>").toString("base64url"),
            },
          },
        ],
      },
    };

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread10" }],
      threadMessages: { thread10: [msg as any] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect((events[0].data["contentText"] as string)).toContain("Plain text content here");
  });

  it("ignores quoted/forwarded text for event detection", async () => {
    const body =
      "Sounds good, let me know.\n" +
      "On Mon, Apr 7, 2026 at 10:00 AM Boss wrote:\n" +
      "Action item: Please follow up on the API design review by Friday.";

    const msg = makeMessage({
      id: "msg-quoted",
      threadId: "thread-quoted",
      from: "colleague@example.com",
      to: "me@example.com",
      subject: "Re: Sprint Tasks",
      body,
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread-quoted" }],
      threadMessages: { "thread-quoted": [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    // Should NOT be followup_assigned because the action item is in the quoted part
    expect(events[0].type).toBe("message_received");
  });

  it("detects event from original text, not forwarded text", async () => {
    const body =
      "We agreed to proceed with plan B.\n" +
      "---------- Forwarded message ----------\n" +
      "Let's go with plan A.";

    const msg = makeMessage({
      id: "msg-fwd",
      threadId: "thread-fwd",
      from: "boss@example.com",
      to: "me@example.com",
      subject: "Decision",
      body,
    });

    const mockGmail = makeMockGmail({
      threads: [{ id: "thread-fwd" }],
      threadMessages: { "thread-fwd": [msg] },
    });

    const connector = new GmailConnector(() => mockGmail as any);
    const events = await connector.fetchEvents(baseConfig);

    expect(events[0].type).toBe("decision_made");
  });
});
