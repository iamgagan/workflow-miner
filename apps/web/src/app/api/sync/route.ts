import { NextRequest, NextResponse } from "next/server";
import type { BrainClient as EngineBrainClient } from "@workflow-miner/engine";
import { createClient } from "@/lib/supabase/server";
import { LocalBrainClient } from "@/lib/local-brain-client";

export const runtime = "nodejs";
export const maxDuration = 120;

type SourceName = "gmail" | "calendar" | "slack" | "linear" | "github" | "notion" | "jira" | "outlook";

const ALL_SOURCES: readonly SourceName[] = [
  "gmail",
  "calendar",
  "slack",
  "linear",
  "github",
  "notion",
  "jira",
  "outlook",
];

interface SourceResult {
  readonly events: number;
  readonly status: "ok" | "skipped" | "error";
  readonly error?: string;
}

/**
 * Load credentials for a given source.
 *
 * Resolution order, in priority:
 *   1. The `tokens` JSONB blob on the connector_tokens row, if present.
 *      This is the canonical desktop-mode storage shape.
 *   2. Individual OAuth columns (access_token, refresh_token) merged with
 *      bundled client credentials from the environment. This handles the
 *      hosted Google OAuth flow.
 *   3. Pure environment variables, for CLI/dev usage.
 */
async function loadCredentials(
  source: SourceName,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Record<string, string>> {
  // Try connector_tokens table first
  let row: Record<string, unknown> | null = null;
  try {
    const result = await supabase
      .from("connector_tokens")
      .select("access_token, refresh_token, expires_at, scopes, tokens, metadata")
      .eq("user_id", userId)
      .eq("provider", source === "calendar" || source === "gmail" ? "google" : source)
      .single();

    if (!result.error && result.data) {
      row = result.data as Record<string, unknown>;
    }
  } catch {
    // Table may not exist yet — fall through
  }

  // Path 1: tokens JSONB blob already in the canonical shape
  if (row && row.tokens && typeof row.tokens === "object") {
    const tokens = row.tokens as Record<string, string>;
    if (Object.keys(tokens).length > 0) {
      return tokens;
    }
  }

  // Path 2: Individual OAuth columns + env-provided client credentials
  const env = process.env;
  if (row && (row.refresh_token || row.access_token)) {
    const refreshToken = String(row.refresh_token ?? row.access_token ?? "");
    switch (source) {
      case "gmail":
        return {
          GMAIL_CLIENT_ID: env.GMAIL_CLIENT_ID ?? "",
          GMAIL_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET ?? "",
          GMAIL_REFRESH_TOKEN: refreshToken,
          GMAIL_USER_EMAIL: env.GMAIL_USER_EMAIL ?? "",
        };
      case "calendar":
        return {
          CALENDAR_CLIENT_ID: env.GMAIL_CLIENT_ID ?? env.CALENDAR_CLIENT_ID ?? "",
          CALENDAR_CLIENT_SECRET:
            env.GMAIL_CLIENT_SECRET ?? env.CALENDAR_CLIENT_SECRET ?? "",
          CALENDAR_REFRESH_TOKEN: refreshToken,
        };
      case "slack":
        return { SLACK_BOT_TOKEN: refreshToken, SLACK_CHANNEL_IDS: env.SLACK_CHANNEL_IDS ?? "" };
      case "linear":
        return { LINEAR_API_KEY: refreshToken };
      case "github":
        return { GITHUB_TOKEN: refreshToken, GITHUB_REPOS: env.GITHUB_REPOS ?? "" };
      case "notion":
        return { NOTION_TOKEN: refreshToken };
      case "jira":
        return { JIRA_EMAIL: env.JIRA_EMAIL ?? "", JIRA_API_TOKEN: refreshToken, JIRA_DOMAIN: env.JIRA_DOMAIN ?? "" };
      case "outlook":
        return {
          OUTLOOK_CLIENT_ID: env.OUTLOOK_CLIENT_ID ?? "",
          OUTLOOK_CLIENT_SECRET: env.OUTLOOK_CLIENT_SECRET ?? "",
          OUTLOOK_REFRESH_TOKEN: refreshToken,
          OUTLOOK_TENANT_ID: env.OUTLOOK_TENANT_ID ?? "common",
          OUTLOOK_USER_EMAIL: env.OUTLOOK_USER_EMAIL ?? "",
        };
    }
  }

  // Path 3: Pure environment variables (CLI / dev fallback)
  switch (source) {
    case "gmail":
      return { GMAIL_CLIENT_ID: env.GMAIL_CLIENT_ID ?? "", GMAIL_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET ?? "", GMAIL_REFRESH_TOKEN: env.GMAIL_REFRESH_TOKEN ?? "", GMAIL_USER_EMAIL: env.GMAIL_USER_EMAIL ?? "" };
    case "calendar":
      return { CALENDAR_CLIENT_ID: env.CALENDAR_CLIENT_ID ?? "", CALENDAR_CLIENT_SECRET: env.CALENDAR_CLIENT_SECRET ?? "", CALENDAR_REFRESH_TOKEN: env.CALENDAR_REFRESH_TOKEN ?? "" };
    case "slack":
      return { SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN ?? "", SLACK_CHANNEL_IDS: env.SLACK_CHANNEL_IDS ?? "" };
    case "linear":
      return { LINEAR_API_KEY: env.LINEAR_API_KEY ?? "" };
    case "github":
      return { GITHUB_TOKEN: env.GITHUB_TOKEN ?? "", GITHUB_REPOS: env.GITHUB_REPOS ?? "" };
    case "notion":
      return { NOTION_TOKEN: env.NOTION_TOKEN ?? "" };
    case "jira":
      return { JIRA_EMAIL: env.JIRA_EMAIL ?? "", JIRA_API_TOKEN: env.JIRA_API_TOKEN ?? "", JIRA_DOMAIN: env.JIRA_DOMAIN ?? "" };
    case "outlook":
      return { OUTLOOK_CLIENT_ID: env.OUTLOOK_CLIENT_ID ?? "", OUTLOOK_CLIENT_SECRET: env.OUTLOOK_CLIENT_SECRET ?? "", OUTLOOK_REFRESH_TOKEN: env.OUTLOOK_REFRESH_TOKEN ?? "", OUTLOOK_TENANT_ID: env.OUTLOOK_TENANT_ID ?? "common", OUTLOOK_USER_EMAIL: env.OUTLOOK_USER_EMAIL ?? "" };
  }
}

/**
 * Check whether credentials contain at least one non-empty required key
 * so we can skip sources with no configuration rather than erroring.
 */
function hasRequiredCredentials(
  source: SourceName,
  credentials: Record<string, string>,
): boolean {
  switch (source) {
    case "gmail":
      return Boolean(credentials.GMAIL_CLIENT_ID && credentials.GMAIL_CLIENT_SECRET && credentials.GMAIL_REFRESH_TOKEN);
    case "calendar":
      return Boolean(credentials.CALENDAR_CLIENT_ID && credentials.CALENDAR_CLIENT_SECRET && credentials.CALENDAR_REFRESH_TOKEN);
    case "slack":
      return Boolean(credentials.SLACK_BOT_TOKEN);
    case "linear":
      return Boolean(credentials.LINEAR_API_KEY);
    case "github":
      return Boolean(credentials.GITHUB_TOKEN && credentials.GITHUB_REPOS);
    case "notion":
      return Boolean(credentials.NOTION_TOKEN);
    case "jira":
      return Boolean(credentials.JIRA_EMAIL && credentials.JIRA_API_TOKEN && credentials.JIRA_DOMAIN);
    case "outlook":
      return Boolean(credentials.OUTLOOK_CLIENT_ID && credentials.OUTLOOK_CLIENT_SECRET && credentials.OUTLOOK_REFRESH_TOKEN);
  }
}

/**
 * Dynamically import the engine package to avoid bundling Node.js-only
 * modules (googleapis, better-sqlite3) into edge or client bundles.
 */
async function getEngine() {
  const engine = await import("@workflow-miner/engine");
  return engine;
}

function createConnector(
  source: SourceName,
  engine: Awaited<ReturnType<typeof getEngine>>,
) {
  switch (source) {
    case "gmail":
      return new engine.GmailConnector();
    case "calendar":
      return new engine.CalendarConnector();
    case "slack":
      return new engine.SlackConnector();
    case "linear":
      return new engine.LinearConnector();
    case "github":
      return new engine.GitHubConnector();
    case "notion":
      return new engine.NotionConnector();
    case "jira":
      return new engine.JiraConnector();
    case "outlook":
      return new engine.OutlookConnector();
  }
}

const DEFAULT_LOOKBACK_DAYS = 14;

export async function POST(request: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 2. Parse query params
  const { searchParams } = new URL(request.url);
  const sourceParam = searchParams.get("source") ?? "all";
  const lookbackDays = parseInt(
    searchParams.get("lookbackDays") ?? String(DEFAULT_LOOKBACK_DAYS),
    10,
  );

  const sourcesToSync: readonly SourceName[] =
    sourceParam === "all"
      ? ALL_SOURCES
      : ALL_SOURCES.filter((s) => s === sourceParam);

  if (sourcesToSync.length === 0) {
    return NextResponse.json(
      {
        error: `Invalid source: ${sourceParam}. Must be one of: ${ALL_SOURCES.join(", ")}, all`,
      },
      { status: 400 },
    );
  }

  // 3. Dynamically import the engine
  const engine = await getEngine();

  // 4. Set up brain writer — the brain lives in local PGlite, so we
  // construct a LocalBrainClient and cast it to the engine's BrainClient
  // shape (structural, only putPage/addTimelineEntry/addLink are used).
  const brainClient: EngineBrainClient = new LocalBrainClient() as unknown as EngineBrainClient;
  const ingestWriter = new engine.IngestWriter(brainClient);
  const normalizer = new engine.Normalizer();

  // 5. Sync each source independently
  const results: Record<string, SourceResult> = {};

  for (const source of sourcesToSync) {
    try {
      const credentials = await loadCredentials(source, user.id, supabase);

      if (!hasRequiredCredentials(source, credentials)) {
        results[source] = {
          events: 0,
          status: "skipped",
          error: "No credentials configured",
        };
        continue;
      }

      const connector = createConnector(source, engine);
      const rawEvents = await connector.fetchEvents({
        credentials,
        lookbackDays,
      });

      const { events: normalizedEvents, errors } =
        normalizer.normalize(rawEvents);

      const writeResult = await ingestWriter.writeEvents(normalizedEvents);

      results[source] = {
        events: normalizedEvents.length,
        status: "ok",
        ...(errors.length > 0
          ? { error: `${errors.length} events failed to normalize` }
          : {}),
      };

      // Log activity (best-effort, ignore errors)
      try {
        await supabase.from("activity_log").insert({
          user_id: user.id,
          source,
          type: "ingest",
          description: `Ingested ${normalizedEvents.length} ${source} events (${writeResult.pagesCreated} pages, ${writeResult.timelineEntries} timeline entries, ${writeResult.linksCreated} links)`,
        });
      } catch {
        // activity_log table may not exist — non-critical
      }
    } catch (err) {
      results[source] = {
        events: 0,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return NextResponse.json({ sources: results });
}
