import { google, type gmail_v1 } from "googleapis";
import type {
  ConnectorConfig,
  ConnectorInterface,
  RawEvent,
  RawParticipant,
} from "./types.js";

const MAX_RESULTS_PER_PAGE = 100;
const BODY_PREVIEW_LENGTH = 500;
const RATE_LIMIT_DELAY_MS = 250;
const HTTP_TIMEOUT_MS = 30_000;

interface GmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly internalDate: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly bodyPreview: string;
  readonly labelIds: readonly string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEmailAddress(header: string): { name: string; email: string } {
  const match = header.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2] };
  }
  return { name: header.trim(), email: header.trim() };
}

function getHeader(
  headers: readonly gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBodyPreview(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    return decoded.slice(0, BODY_PREVIEW_LENGTH);
  }

  if (payload.parts) {
    const textPart = payload.parts.find(
      (p) => p.mimeType === "text/plain",
    );
    if (textPart?.body?.data) {
      const decoded = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
      return decoded.slice(0, BODY_PREVIEW_LENGTH);
    }
    for (const part of payload.parts) {
      const nested = extractBodyPreview(part);
      if (nested) return nested;
    }
  }

  return "";
}

/**
 * Strip quoted/forwarded lines from email body so that event detection
 * only considers the original message text.
 */
function stripQuotedText(body: string): string {
  const lines = body.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    // Stop at common quote markers
    if (/^>/.test(line)) continue;
    if (/^On .+ wrote:$/.test(line.trim())) break;
    if (/^---------- Forwarded message/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message/.test(line.trim())) break;
    if (/^From:.*\d{4}/.test(line.trim())) break;
    result.push(line);
  }
  return result.join("\n");
}

function detectEventType(
  message: GmailMessage,
  userEmail: string,
  isReply: boolean,
): string {
  const strippedBody = stripQuotedText(message.bodyPreview);
  const bodyLower = strippedBody.toLowerCase();
  const subjectLower = message.subject.toLowerCase();

  if (
    bodyLower.includes("action item:") ||
    bodyLower.includes("follow up:") ||
    bodyLower.includes("todo:") ||
    bodyLower.includes("please follow up") ||
    subjectLower.includes("action required")
  ) {
    return "followup_assigned";
  }

  if (
    bodyLower.includes("decided to") ||
    bodyLower.includes("decision:") ||
    bodyLower.includes("we agreed") ||
    bodyLower.includes("approved") ||
    bodyLower.includes("let's go with")
  ) {
    return "decision_made";
  }

  const fromEmail = parseEmailAddress(message.from).email.toLowerCase();
  if (userEmail && fromEmail === userEmail.toLowerCase()) {
    return "message_sent";
  }

  // Fallback: when GMAIL_USER_EMAIL is not configured, use the SENT label
  // to distinguish sent from received messages.
  if (!userEmail && message.labelIds.includes("SENT")) {
    return "message_sent";
  }

  return "message_received";
}

function buildParticipants(message: GmailMessage): readonly RawParticipant[] {
  const seen = new Set<string>();
  const participants: RawParticipant[] = [];

  const addParticipant = (header: string) => {
    if (!header) return;
    const addresses = header.split(",").map((s) => s.trim()).filter(Boolean);
    for (const addr of addresses) {
      const { name, email } = parseEmailAddress(addr);
      if (!seen.has(email.toLowerCase())) {
        seen.add(email.toLowerCase());
        participants.push({
          id: email.toLowerCase(),
          name: name || email,
          type: "person",
        });
      }
    }
  };

  addParticipant(message.from);
  addParticipant(message.to);

  return participants;
}

export class GmailConnector implements ConnectorInterface {
  readonly source = "gmail";

  private readonly gmailFactory: (auth: InstanceType<typeof google.auth.OAuth2>) => gmail_v1.Gmail;

  constructor(
    gmailFactory?: (auth: InstanceType<typeof google.auth.OAuth2>) => gmail_v1.Gmail,
  ) {
    this.gmailFactory =
      gmailFactory ??
      ((auth: InstanceType<typeof google.auth.OAuth2>) => {
        return google.gmail({ version: "v1", auth, timeout: HTTP_TIMEOUT_MS });
      });
  }

  async fetchEvents(config: ConnectorConfig): Promise<readonly RawEvent[]> {
    const clientId = config.credentials["GMAIL_CLIENT_ID"];
    const clientSecret = config.credentials["GMAIL_CLIENT_SECRET"];
    const refreshToken = config.credentials["GMAIL_REFRESH_TOKEN"];

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN in credentials");
    }

    const userEmail = config.credentials["GMAIL_USER_EMAIL"] ?? "";

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    const gmail = this.gmailFactory(auth);
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - config.lookbackDays);
    const afterEpoch = Math.floor(afterDate.getTime() / 1000);

    const threadIds = await this.fetchThreadIds(gmail, afterEpoch);
    const events: RawEvent[] = [];

    for (const threadId of threadIds) {
      const messages = await this.fetchThreadMessages(gmail, threadId);
      const isReplyChain = messages.length > 1;

      for (const message of messages) {
        const eventType = detectEventType(message, userEmail, isReplyChain);
        const contentText = message.subject
          ? `${message.subject}: ${message.bodyPreview}`
          : message.bodyPreview;

        events.push({
          id: `gmail-${message.id}`,
          source: "gmail",
          type: eventType,
          timestamp: new Date(parseInt(message.internalDate, 10)),
          participants: buildParticipants(message),
          data: {
            threadId: message.threadId,
            subject: message.subject,
            contentText: contentText.slice(0, BODY_PREVIEW_LENGTH),
            labelIds: message.labelIds,
            isReply: isReplyChain,
          },
        });
      }

      await sleep(RATE_LIMIT_DELAY_MS);
    }

    return events;
  }

  private async fetchThreadIds(
    gmail: gmail_v1.Gmail,
    afterEpoch: number,
  ): Promise<readonly string[]> {
    const threadIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const response = await gmail.users.threads.list({
        userId: "me",
        q: `after:${afterEpoch}`,
        maxResults: MAX_RESULTS_PER_PAGE,
        pageToken,
      });

      const threads = response.data.threads ?? [];
      for (const thread of threads) {
        if (thread.id) {
          threadIds.push(thread.id);
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
      if (pageToken) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }
    } while (pageToken);

    return threadIds;
  }

  private async fetchThreadMessages(
    gmail: gmail_v1.Gmail,
    threadId: string,
  ): Promise<readonly GmailMessage[]> {
    const response = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full",
    });

    const messages = response.data.messages ?? [];
    return messages.map((msg) => {
      const headers = msg.payload?.headers;
      return {
        id: msg.id ?? "",
        threadId: msg.threadId ?? threadId,
        internalDate: msg.internalDate ?? "0",
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        subject: getHeader(headers, "Subject"),
        bodyPreview: extractBodyPreview(msg.payload ?? undefined),
        labelIds: (msg.labelIds ?? []) as readonly string[],
      };
    });
  }
}
