import type { ConnectorConfig, ConnectorInterface, RawEvent, RawParticipant } from "./types.js";
import { fetchWithRetry } from "./http-utils.js";

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
const MAX_MESSAGES = 200;
const BODY_PREVIEW_LENGTH = 500;

interface GraphMessage {
  readonly id: string;
  readonly subject: string;
  readonly bodyPreview: string;
  readonly receivedDateTime: string;
  readonly sentDateTime: string;
  readonly from: { readonly emailAddress: { readonly name: string; readonly address: string } };
  readonly toRecipients: readonly { readonly emailAddress: { readonly name: string; readonly address: string } }[];
  readonly conversationId: string;
  readonly isDraft: boolean;
  readonly isRead: boolean;
  readonly categories: readonly string[];
  readonly webLink: string;
}

interface FetchFn {
  (url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

function emailToParticipant(email: { name: string; address: string }): RawParticipant {
  return { id: email.address.toLowerCase(), name: email.name || email.address, type: "person" };
}

function detectEventType(message: GraphMessage, userEmail: string): string {
  const body = message.bodyPreview.toLowerCase();
  const subject = message.subject.toLowerCase();

  if (
    body.includes("action item:") ||
    body.includes("todo:") ||
    body.includes("please follow up") ||
    subject.includes("action required")
  ) {
    return "followup_assigned";
  }

  if (
    body.includes("decided to") ||
    body.includes("decision:") ||
    body.includes("approved") ||
    body.includes("let's go with")
  ) {
    return "decision_made";
  }

  if (message.from.emailAddress.address.toLowerCase() === userEmail.toLowerCase()) {
    return "message_sent";
  }

  return "message_received";
}

export class OutlookConnector implements ConnectorInterface {
  readonly source = "outlook";

  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  }

  async fetchEvents(config: ConnectorConfig): Promise<readonly RawEvent[]> {
    const clientId = config.credentials["OUTLOOK_CLIENT_ID"];
    const clientSecret = config.credentials["OUTLOOK_CLIENT_SECRET"];
    const refreshToken = config.credentials["OUTLOOK_REFRESH_TOKEN"];
    const tenantId = config.credentials["OUTLOOK_TENANT_ID"] || "common";
    const userEmail = config.credentials["OUTLOOK_USER_EMAIL"] ?? "";

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Missing OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, or OUTLOOK_REFRESH_TOKEN in credentials");
    }

    const accessToken = await this.refreshAccessToken(clientId, clientSecret, refreshToken, tenantId);

    const since = new Date();
    since.setDate(since.getDate() - config.lookbackDays);

    const messages = await this.fetchMessages(accessToken, since);
    const events: RawEvent[] = [];

    for (const msg of messages) {
      if (msg.isDraft) continue;

      const participants: RawParticipant[] = [emailToParticipant(msg.from.emailAddress)];
      for (const to of msg.toRecipients) {
        participants.push(emailToParticipant(to.emailAddress));
      }

      events.push({
        id: `outlook-${msg.id}`,
        source: "outlook",
        type: detectEventType(msg, userEmail),
        timestamp: msg.receivedDateTime,
        participants,
        data: {
          subject: msg.subject,
          bodyPreview: msg.bodyPreview.slice(0, BODY_PREVIEW_LENGTH),
          conversationId: msg.conversationId,
          categories: msg.categories,
        },
      });
    }

    return events;
  }

  private async refreshAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    tenantId: string,
  ): Promise<string> {
    const url = TOKEN_URL.replace("{tenant}", tenantId);
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "https://graph.microsoft.com/Mail.Read offline_access",
    });

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, { fetchFn: this.fetchFn as unknown as (url: string, init?: RequestInit) => Promise<Response> });

    if (!response.ok) {
      throw new Error(`Outlook token refresh failed: HTTP ${response.status}`);
    }

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  private async fetchMessages(accessToken: string, since: Date): Promise<GraphMessage[]> {
    const filter = `receivedDateTime ge ${since.toISOString()}`;
    const url = `${GRAPH_API}/me/messages?$filter=${encodeURIComponent(filter)}&$top=${MAX_MESSAGES}&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients,conversationId,isDraft,isRead,categories,webLink`;

    const response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }, { fetchFn: this.fetchFn as unknown as (url: string, init?: RequestInit) => Promise<Response> });

    if (!response.ok) {
      throw new Error(`Microsoft Graph API error: HTTP ${response.status}`);
    }

    const data = await response.json() as { value: GraphMessage[] };
    return data.value;
  }
}
