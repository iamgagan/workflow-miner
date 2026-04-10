import type { ConnectorConfig, ConnectorInterface, RawEvent, RawParticipant } from "./types.js";
import { fetchWithRetry } from "./http-utils.js";

interface CalendarEventAttendee {
  readonly email: string;
  readonly displayName?: string;
  readonly responseStatus?: string;
  readonly self?: boolean;
}

interface CalendarEvent {
  readonly id: string;
  readonly summary?: string;
  readonly description?: string;
  readonly status?: string;
  readonly start?: { readonly dateTime?: string; readonly date?: string };
  readonly end?: { readonly dateTime?: string; readonly date?: string };
  readonly attendees?: readonly CalendarEventAttendee[];
  readonly recurringEventId?: string;
  readonly recurrence?: readonly string[];
  readonly organizer?: { readonly email?: string; readonly displayName?: string };
  readonly created?: string;
  readonly updated?: string;
  readonly htmlLink?: string;
}

interface CalendarListResponse {
  readonly items?: readonly CalendarEvent[];
  readonly nextPageToken?: string;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly token_type: string;
}

export interface CalendarFetchDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => Date;
}

function getEventTime(event: CalendarEvent): Date | null {
  const raw = event.start?.dateTime ?? event.start?.date;
  if (!raw) return null;
  return new Date(raw);
}

function isCancelled(event: CalendarEvent): boolean {
  return event.status === "cancelled";
}

function classifyEvent(
  event: CalendarEvent,
  now: Date,
): "meeting_scheduled" | "meeting_held" | "meeting_cancelled" {
  if (isCancelled(event)) return "meeting_cancelled";
  const time = getEventTime(event);
  if (!time) return "meeting_scheduled";
  return time <= now ? "meeting_held" : "meeting_scheduled";
}

function buildParticipants(event: CalendarEvent): readonly RawParticipant[] {
  const participants: RawParticipant[] = [];

  if (event.organizer?.email) {
    participants.push({
      id: event.organizer.email,
      name: event.organizer.displayName ?? event.organizer.email,
      type: "organizer",
    });
  }

  for (const attendee of event.attendees ?? []) {
    participants.push({
      id: attendee.email,
      name: attendee.displayName ?? attendee.email,
      type: attendee.self ? "self" : "attendee",
    });
  }

  return participants;
}

function toRawEvent(event: CalendarEvent, now: Date): RawEvent {
  const eventType = classifyEvent(event, now);
  const time = getEventTime(event);

  return {
    id: `calendar-${event.id}`,
    source: "calendar",
    type: eventType,
    timestamp: time ?? now,
    participants: buildParticipants(event),
    data: {
      summary: event.summary ?? "",
      description: event.description ?? "",
      recurringEventId: event.recurringEventId ?? null,
      recurrence: event.recurrence ?? null,
      htmlLink: event.htmlLink ?? null,
      status: event.status ?? "confirmed",
      endTime: event.end?.dateTime ?? event.end?.date ?? null,
    },
  };
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetchFn: typeof globalThis.fetch,
): Promise<string> {
  const response = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  }, { fetchFn });

  if (!response.ok) {
    throw new Error(`Failed to refresh access token: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}

async function fetchCalendarEventsPage(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  fetchFn: typeof globalThis.fetch,
): Promise<readonly CalendarEvent[]> {
  const allEvents: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetchWithRetry(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      { fetchFn },
    );

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: { message?: string } };
        if (body.error?.message) detail = ` — ${body.error.message}`;
      } catch { /* ignore parse errors */ }
      throw new Error(`Calendar API error: ${response.status} ${response.statusText}${detail}`);
    }

    const data = (await response.json()) as CalendarListResponse;
    if (data.items) {
      allEvents.push(...data.items);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allEvents;
}

export class CalendarConnector implements ConnectorInterface {
  readonly source = "calendar";

  private readonly deps: CalendarFetchDeps;

  constructor(deps?: CalendarFetchDeps) {
    this.deps = deps ?? { fetch: globalThis.fetch.bind(globalThis) };
  }

  async fetchEvents(config: ConnectorConfig): Promise<readonly RawEvent[]> {
    const clientId = config.credentials["CALENDAR_CLIENT_ID"];
    const clientSecret = config.credentials["CALENDAR_CLIENT_SECRET"];
    const refreshToken = config.credentials["CALENDAR_REFRESH_TOKEN"];

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Missing CALENDAR_CLIENT_ID, CALENDAR_CLIENT_SECRET, or CALENDAR_REFRESH_TOKEN in credentials");
    }

    const now = this.deps.now?.() ?? new Date();
    const timeMin = new Date(now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000);
    const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken, this.deps.fetch);
    const events = await fetchCalendarEventsPage(
      accessToken,
      timeMin.toISOString(),
      timeMax.toISOString(),
      this.deps.fetch,
    );

    return events.map((event) => toRawEvent(event, now));
  }
}

/** @deprecated Use CalendarConnector class instead */
export async function fetchCalendarEvents(
  calendarConfig: { clientId: string; clientSecret: string; refreshToken: string },
  deps: CalendarFetchDeps,
  daysBack: number = 30,
): Promise<readonly RawEvent[]> {
  const connector = new CalendarConnector(deps);
  return connector.fetchEvents({
    credentials: {
      CALENDAR_CLIENT_ID: calendarConfig.clientId,
      CALENDAR_CLIENT_SECRET: calendarConfig.clientSecret,
      CALENDAR_REFRESH_TOKEN: calendarConfig.refreshToken,
    },
    lookbackDays: daysBack,
  });
}
