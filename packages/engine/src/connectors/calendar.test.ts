import { describe, it, expect, vi } from "vitest";
import { fetchCalendarEvents, CalendarFetchDeps } from "./calendar.js";
import { CalendarConfig } from "../config/schema.js";

const TEST_CONFIG: CalendarConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
};

const NOW = new Date("2026-04-07T12:00:00Z");

function makeCalendarEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    summary: "Team standup",
    description: "Daily sync",
    status: "confirmed",
    start: { dateTime: "2026-04-06T10:00:00Z" },
    end: { dateTime: "2026-04-06T10:30:00Z" },
    attendees: [
      { email: "alice@example.com", displayName: "Alice", responseStatus: "accepted" },
      { email: "bob@example.com", displayName: "Bob", responseStatus: "tentative" },
    ],
    organizer: { email: "alice@example.com", displayName: "Alice" },
    htmlLink: "https://calendar.google.com/event?eid=evt-1",
    ...overrides,
  };
}

function makeMockFetch(events: unknown[], nextPageToken?: string) {
  return vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "mock-token", expires_in: 3600, token_type: "Bearer" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: events, nextPageToken }),
    });
}

function makeDeps(fetchFn: ReturnType<typeof vi.fn>): CalendarFetchDeps {
  return { fetch: fetchFn as unknown as typeof globalThis.fetch, now: () => NOW };
}

describe("CalendarConnector", () => {
  describe("fetchCalendarEvents", () => {
    it("fetches events and returns RawEvent array", async () => {
      const event = makeCalendarEvent();
      const mockFetch = makeMockFetch([event]);
      const deps = makeDeps(mockFetch);

      const result = await fetchCalendarEvents(TEST_CONFIG, deps);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("calendar-evt-1");
      expect(result[0].source).toBe("calendar");
      expect(result[0].participants).toHaveLength(3); // organizer + 2 attendees
    });

    it("classifies past events as meeting_held", async () => {
      const pastEvent = makeCalendarEvent({
        start: { dateTime: "2026-04-06T10:00:00Z" },
      });
      const mockFetch = makeMockFetch([pastEvent]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result[0].type).toBe("meeting_held");
    });

    it("classifies future events as meeting_scheduled", async () => {
      const futureEvent = makeCalendarEvent({
        id: "evt-future",
        start: { dateTime: "2026-04-10T10:00:00Z" },
        end: { dateTime: "2026-04-10T10:30:00Z" },
      });
      const mockFetch = makeMockFetch([futureEvent]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result[0].type).toBe("meeting_scheduled");
    });

    it("classifies cancelled events as meeting_cancelled", async () => {
      const cancelledEvent = makeCalendarEvent({
        id: "evt-cancelled",
        status: "cancelled",
      });
      const mockFetch = makeMockFetch([cancelledEvent]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result[0].type).toBe("meeting_cancelled");
    });

    it("handles all-day events (date instead of dateTime)", async () => {
      const allDayEvent = makeCalendarEvent({
        id: "evt-allday",
        start: { date: "2026-04-06" },
        end: { date: "2026-04-07" },
      });
      const mockFetch = makeMockFetch([allDayEvent]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("meeting_held");
    });

    it("extracts attendees and organizer as participants", async () => {
      const event = makeCalendarEvent();
      const mockFetch = makeMockFetch([event]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      const participants = result[0].participants;
      expect(participants[0]).toEqual({
        id: "alice@example.com",
        name: "Alice",
        type: "organizer",
      });
      expect(participants[1]).toEqual({
        id: "alice@example.com",
        name: "Alice",
        type: "attendee",
      });
      expect(participants[2]).toEqual({
        id: "bob@example.com",
        name: "Bob",
        type: "attendee",
      });
    });

    it("handles events with no attendees", async () => {
      const soloEvent = makeCalendarEvent({
        id: "evt-solo",
        attendees: undefined,
        organizer: { email: "me@example.com" },
      });
      const mockFetch = makeMockFetch([soloEvent]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result[0].participants).toHaveLength(1);
      expect(result[0].participants[0].type).toBe("organizer");
    });

    it("includes recurring event metadata in data", async () => {
      const recurringEvent = makeCalendarEvent({
        id: "evt-recur",
        recurringEventId: "master-evt-1",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      });
      const mockFetch = makeMockFetch([recurringEvent]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result[0].data.recurringEventId).toBe("master-evt-1");
      expect(result[0].data.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
    });

    it("paginates through multiple pages", async () => {
      const event1 = makeCalendarEvent({ id: "evt-page1" });
      const event2 = makeCalendarEvent({ id: "evt-page2" });

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "mock-token", expires_in: 3600, token_type: "Bearer" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [event1], nextPageToken: "page2" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [event2] }),
        });

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("calendar-evt-page1");
      expect(result[1].id).toBe("calendar-evt-page2");
    });

    it("throws on token refresh failure", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch))).rejects.toThrow(
        "Failed to refresh access token: 401 Unauthorized",
      );
    });

    it("throws on API fetch failure", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "mock-token", expires_in: 3600, token_type: "Bearer" }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        });

      await expect(fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch))).rejects.toThrow(
        "Calendar API error: 403 Forbidden",
      );
    });

    it("sends correct OAuth params for token refresh", async () => {
      const mockFetch = makeMockFetch([]);
      await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[0]).toBe("https://oauth2.googleapis.com/token");
      const body = tokenCall[1].body as URLSearchParams;
      expect(body.get("client_id")).toBe("test-client-id");
      expect(body.get("grant_type")).toBe("refresh_token");
    });

    it("passes correct time range and params to API", async () => {
      const mockFetch = makeMockFetch([]);
      await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch), 30);

      const apiCall = mockFetch.mock.calls[1];
      const url = new URL(apiCall[0] as string);
      expect(url.pathname).toBe("/calendar/v3/calendars/primary/events");
      expect(url.searchParams.get("singleEvents")).toBe("true");
      expect(url.searchParams.get("orderBy")).toBe("startTime");
      expect(apiCall[1].headers.Authorization).toBe("Bearer mock-token");
    });

    it("handles self attendee flag", async () => {
      const event = makeCalendarEvent({
        attendees: [
          { email: "me@example.com", displayName: "Me", self: true },
          { email: "other@example.com", displayName: "Other" },
        ],
      });
      const mockFetch = makeMockFetch([event]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      const selfParticipant = result[0].participants.find((p) => p.id === "me@example.com");
      expect(selfParticipant?.type).toBe("self");
    });

    it("falls back to email when displayName is missing", async () => {
      const event = makeCalendarEvent({
        attendees: [{ email: "no-name@example.com" }],
        organizer: { email: "org@example.com" },
      });
      const mockFetch = makeMockFetch([event]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result[0].participants[0].name).toBe("org@example.com");
      expect(result[0].participants[1].name).toBe("no-name@example.com");
    });

    it("returns empty array when no events", async () => {
      const mockFetch = makeMockFetch([]);

      const result = await fetchCalendarEvents(TEST_CONFIG, makeDeps(mockFetch));

      expect(result).toEqual([]);
    });
  });
});
