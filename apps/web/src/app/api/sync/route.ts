import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type SourceName = "gmail" | "calendar" | "slack" | "linear";

const ALL_SOURCES: readonly SourceName[] = [
  "gmail",
  "calendar",
  "slack",
  "linear",
];

interface SourceResult {
  readonly events: number;
  readonly status: "ok" | "skipped" | "error";
  readonly error?: string;
}

/**
 * Load credentials for a given source.
 * Tries connector_tokens table first, falls back to env vars.
 */
async function loadCredentials(
  source: SourceName,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Record<string, string>> {
  // Try connector_tokens table first
  try {
    const { data, error } = await supabase
      .from("connector_tokens")
      .select("tokens")
      .eq("user_id", userId)
      .eq("provider", source)
      .single();

    if (!error && data?.tokens && typeof data.tokens === "object") {
      return data.tokens as Record<string, string>;
    }
  } catch {
    // Table may not exist yet — fall through to env vars
  }

  // Fall back to environment variables
  const env = process.env;
  switch (source) {
    case "gmail":
      return {
        GMAIL_CLIENT_ID: env.GMAIL_CLIENT_ID ?? "",
        GMAIL_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET ?? "",
        GMAIL_REFRESH_TOKEN: env.GMAIL_REFRESH_TOKEN ?? "",
        GMAIL_USER_EMAIL: env.GMAIL_USER_EMAIL ?? "",
      };
    case "calendar":
      return {
        CALENDAR_CLIENT_ID: env.CALENDAR_CLIENT_ID ?? "",
        CALENDAR_CLIENT_SECRET: env.CALENDAR_CLIENT_SECRET ?? "",
        CALENDAR_REFRESH_TOKEN: env.CALENDAR_REFRESH_TOKEN ?? "",
      };
    case "slack":
      return {
        SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN ?? "",
        SLACK_CHANNEL_IDS: env.SLACK_CHANNEL_IDS ?? "",
      };
    case "linear":
      return {
        LINEAR_API_KEY: env.LINEAR_API_KEY ?? "",
      };
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
      return Boolean(
        credentials.GMAIL_CLIENT_ID &&
          credentials.GMAIL_CLIENT_SECRET &&
          credentials.GMAIL_REFRESH_TOKEN,
      );
    case "calendar":
      return Boolean(
        credentials.CALENDAR_CLIENT_ID &&
          credentials.CALENDAR_CLIENT_SECRET &&
          credentials.CALENDAR_REFRESH_TOKEN,
      );
    case "slack":
      return Boolean(credentials.SLACK_BOT_TOKEN);
    case "linear":
      return Boolean(credentials.LINEAR_API_KEY);
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

  // 4. Set up brain writer
  const brainClient = new engine.BrainClient({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  });
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
