import { describe, it, expect, vi } from "vitest";
import { OutlookConnector } from "./outlook.js";
import { getAllEvents, type ConnectorConfig } from "./types.js";

function mockMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-abc",
    subject: "Sprint review",
    bodyPreview: "Let's discuss the sprint review",
    receivedDateTime: "2026-04-10T10:00:00Z",
    sentDateTime: "2026-04-10T10:00:00Z",
    from: {
      emailAddress: { name: "Alice Smith", address: "alice@example.com" },
    },
    toRecipients: [
      { emailAddress: { name: "Bob Jones", address: "bob@example.com" } },
    ],
    conversationId: "conv-1",
    isDraft: false,
    isRead: true,
    categories: [],
    webLink: "https://outlook.com/msg-abc",
    ...overrides,
  };
}

/** Simulates the two-step flow: token refresh, then Graph API fetch. */
function makeFetchFn(messages: unknown[]) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("login.microsoftonline.com")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "new-access-token" }),
      });
    }
    if (url.includes("graph.microsoft.com")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ value: messages }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

const baseConfig: ConnectorConfig = {
  credentials: {
    OUTLOOK_CLIENT_ID: "client-id",
    OUTLOOK_CLIENT_SECRET: "client-secret",
    OUTLOOK_REFRESH_TOKEN: "refresh-token",
    OUTLOOK_TENANT_ID: "common",
    OUTLOOK_USER_EMAIL: "me@example.com",
  },
  lookbackDays: 7,
};

describe("OutlookConnector", () => {
  it("implements ConnectorInterface with source 'outlook'", () => {
    const connector = new OutlookConnector();
    expect(connector.source).toBe("outlook");
  });

  it("throws when required OAuth credentials are missing", async () => {
    const connector = new OutlookConnector();
    await expect(
      getAllEvents(connector, { credentials: { OUTLOOK_CLIENT_ID: "a" }, lookbackDays: 7 }),
    ).rejects.toThrow(/Missing OUTLOOK_/);
  });

  it("refreshes access token and calls Graph API", async () => {
    const fetchFn = makeFetchFn([mockMessage()]);
    const connector = new OutlookConnector(fetchFn);

    await getAllEvents(connector, baseConfig);

    expect(fetchFn).toHaveBeenCalledTimes(2);

    // First call: token refresh
    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0];
    expect(tokenUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(tokenInit.method).toBe("POST");
    expect(tokenInit.body).toContain("refresh_token=refresh-token");
    expect(tokenInit.body).toContain("grant_type=refresh_token");

    // Second call: Graph API with new access token
    const [graphUrl, graphInit] = fetchFn.mock.calls[1];
    expect(graphUrl).toContain("graph.microsoft.com/v1.0/me/messages");
    expect(graphInit.headers.Authorization).toBe("Bearer new-access-token");
  });

  it("uses tenant-specific OAuth endpoint when OUTLOOK_TENANT_ID is set", async () => {
    const fetchFn = makeFetchFn([]);
    const connector = new OutlookConnector(fetchFn);

    await getAllEvents(connector, {
      credentials: { ...baseConfig.credentials, OUTLOOK_TENANT_ID: "tenant-xyz" },
      lookbackDays: 7,
    });

    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://login.microsoftonline.com/tenant-xyz/oauth2/v2.0/token",
    );
  });

  it("classifies messages from user as message_sent", async () => {
    const msg = mockMessage({
      from: { emailAddress: { name: "Me", address: "me@example.com" } },
    });
    const fetchFn = makeFetchFn([msg]);
    const connector = new OutlookConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events[0].type).toBe("message_sent");
  });

  it("classifies incoming messages as message_received", async () => {
    const fetchFn = makeFetchFn([mockMessage()]);
    const connector = new OutlookConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events[0].type).toBe("message_received");
  });

  it("detects decision_made from body keywords", async () => {
    const msg = mockMessage({
      bodyPreview: "We decided to ship on Friday.",
    });
    const fetchFn = makeFetchFn([msg]);
    const connector = new OutlookConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events[0].type).toBe("decision_made");
  });

  it("detects followup_assigned from action item language", async () => {
    const msg = mockMessage({
      bodyPreview: "Action item: please follow up on this.",
    });
    const fetchFn = makeFetchFn([msg]);
    const connector = new OutlookConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events[0].type).toBe("followup_assigned");
  });

  it("skips draft messages", async () => {
    const fetchFn = makeFetchFn([mockMessage({ isDraft: true })]);
    const connector = new OutlookConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events).toHaveLength(0);
  });

  it("builds participants from from + toRecipients", async () => {
    const msg = mockMessage({
      from: { emailAddress: { name: "Alice", address: "alice@example.com" } },
      toRecipients: [
        { emailAddress: { name: "Bob", address: "bob@example.com" } },
        { emailAddress: { name: "Carol", address: "carol@example.com" } },
      ],
    });
    const fetchFn = makeFetchFn([msg]);
    const connector = new OutlookConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events[0].participants.map((p) => p.id).sort()).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
  });

  it("includes conversationId and categories in event data", async () => {
    const msg = mockMessage({
      conversationId: "thread-123",
      categories: ["Urgent", "Client"],
    });
    const fetchFn = makeFetchFn([msg]);
    const connector = new OutlookConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect(events[0].data).toEqual(
      expect.objectContaining({
        conversationId: "thread-123",
        categories: ["Urgent", "Client"],
      }),
    );
  });

  it("throws on token refresh failure", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid_grant" }),
    });
    const connector = new OutlookConnector(fetchFn);
    await expect(getAllEvents(connector, baseConfig)).rejects.toThrow(
      "Outlook token refresh failed: HTTP 401",
    );
  });

  it("throws on Graph API errors", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes("login.microsoftonline.com")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ access_token: "t" }) });
      }
      return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
    });
    const connector = new OutlookConnector(fetchFn);
    await expect(getAllEvents(connector, baseConfig)).rejects.toThrow(
      "Microsoft Graph API error: HTTP 403",
    );
  });

  it("truncates bodyPreview to 500 chars", async () => {
    const longBody = "x".repeat(1000);
    const msg = mockMessage({ bodyPreview: longBody });
    const fetchFn = makeFetchFn([msg]);
    const connector = new OutlookConnector(fetchFn);

    const events = await getAllEvents(connector, baseConfig);
    expect((events[0].data.bodyPreview as string).length).toBe(500);
  });
});
