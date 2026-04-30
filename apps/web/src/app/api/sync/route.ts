import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/inngest/client";
import { LocalBrainClient } from "@/lib/local-brain-client";

const ALL_SOURCES = [
  "gmail",
  "calendar",
  "slack",
  "linear",
  "github",
  "notion",
  "jira",
  "outlook",
] as const;

type SourceName = (typeof ALL_SOURCES)[number];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sourceParam = searchParams.get("source") ?? "all";
  const lookbackDays = parseInt(
    searchParams.get("lookbackDays") ?? "14",
    10,
  );

  const sourcesToSync: readonly SourceName[] =
    sourceParam === "all"
      ? ALL_SOURCES
      : ALL_SOURCES.filter((s): s is SourceName => s === sourceParam);

  if (sourcesToSync.length === 0) {
    return NextResponse.json(
      {
        error: `Invalid source: ${sourceParam}. Must be one of: ${ALL_SOURCES.join(", ")}, all`,
      },
      { status: 400 },
    );
  }

  // ── Desktop: ingest locally via the engine, no Inngest. ──────────────
  // The Tauri shell sets WORKFLOW_MINER_MODE=desktop when spawning the
  // Next.js sidecar; we detect that here and run runIngest() directly so
  // brain_timeline gets populated in the local PGlite DB.
  if (process.env.WORKFLOW_MINER_MODE === "desktop") {
    return runDesktopIngest(user.id, sourcesToSync, lookbackDays);
  }

  // ── Cloud: hand off to Inngest. ──────────────────────────────────────
  const events = sourcesToSync.map((source) => ({
    name: "company/sync.requested" as const,
    data: { userId: user.id, source, lookbackDays },
  }));
  await inngest.send(events);
  return NextResponse.json({
    ok: true,
    mode: "cloud",
    message: `Dispatched ${events.length} sync jobs to Inngest`,
  });
}

async function runDesktopIngest(
  userId: string,
  sources: readonly SourceName[],
  lookbackDays: number,
): Promise<NextResponse> {
  const engine = await import("@workflow-miner/engine");
  const admin = createAdminClient();

  // Build credentials per source from connector_tokens. Gmail + Calendar
  // share a single google row.
  const creds: Partial<Record<SourceName, Record<string, string>>> = {};
  const skipped: string[] = [];

  for (const source of sources) {
    const provider =
      source === "gmail" || source === "calendar" ? "google" : source;
    // local-shim doesn't implement maybeSingle(); .single() throws on
    // missing row, which we catch and treat as skipped.
    let row: { refresh_token?: string | null; tokens?: unknown; access_token?: string | null } | null = null;
    try {
      const result = await admin
        .from("connector_tokens")
        .select("refresh_token, tokens, access_token")
        .eq("user_id", userId)
        .eq("provider", provider)
        .single();
      row = result.data ?? null;
    } catch {
      row = null;
    }

    if (!row) {
      skipped.push(source);
      continue;
    }

    const tokens =
      row.tokens && typeof row.tokens === "object"
        ? (row.tokens as Record<string, string>)
        : {};
    const refresh = String(row.refresh_token ?? "");

    creds[source] = buildCredentials(source, tokens, refresh);
  }

  // Build a Config that runIngest understands. Each source either has
  // credentials or it'll be skipped by buildCredentials() returning an
  // empty object — runIngest's own per-source guard handles that.
  const config = {
    gmail: creds.gmail
      ? {
          clientId: creds.gmail.GMAIL_CLIENT_ID ?? "",
          clientSecret: creds.gmail.GMAIL_CLIENT_SECRET ?? "",
          refreshToken: creds.gmail.GMAIL_REFRESH_TOKEN ?? "",
        }
      : undefined,
    calendar: creds.calendar
      ? {
          clientId: creds.calendar.CALENDAR_CLIENT_ID ?? "",
          clientSecret: creds.calendar.CALENDAR_CLIENT_SECRET ?? "",
          refreshToken: creds.calendar.CALENDAR_REFRESH_TOKEN ?? "",
        }
      : undefined,
    slack: creds.slack
      ? { botToken: creds.slack.SLACK_BOT_TOKEN ?? "" }
      : undefined,
    linear: creds.linear
      ? { apiKey: creds.linear.LINEAR_API_KEY ?? "" }
      : undefined,
  };

  // The engine's runIngest writes raw events to a SQL events table; the
  // brain_timeline rows we want for pattern mining come from IngestWriter
  // running on the normalized events. So we build the pipeline manually
  // here, mirroring the per-source loop in inngest/functions.ts but
  // backed by LocalBrainClient.
  const localBrain = new LocalBrainClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ingestWriter = new engine.IngestWriter(localBrain as any);
  const normalizer = new engine.Normalizer();

  const sourceCounts: Record<string, number> = {};
  const allErrors: { source: string; message: string }[] = [];

  await Promise.all(
    sources.map(async (source) => {
      const sourceCreds = creds[source];
      if (!sourceCreds) return;

      const connector = makeConnector(engine, source);
      if (!connector) return;

      try {
        const rawEvents = await engine.getAllEvents(connector, {
          credentials: sourceCreds,
          lookbackDays,
        });
        const { events, errors } = normalizer.normalize(rawEvents);
        const result = await ingestWriter.writeEvents(events);
        sourceCounts[source] = events.length;
        if (errors.length) {
          for (const err of errors) {
            allErrors.push({ source, message: err.message });
          }
        }
        // (Skipping the lastSync timestamp UPDATE here — local-shim doesn't
        //  implement .update(). The timestamp is already refreshed when the
        //  user reconnects via OAuth, which is enough signal for the alpha.)
        // result is consumed for side effects; ignore the count detail here.
        void result;
      } catch (err) {
        allErrors.push({
          source,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  // Discard config — only kept for symmetry with runIngest's signature.
  void config;

  const totalEvents = Object.values(sourceCounts).reduce((a, b) => a + b, 0);

  return NextResponse.json({
    ok: true,
    mode: "desktop",
    totalEvents,
    sourceCounts,
    skippedSources: skipped,
    errors: allErrors,
  });
}

function buildCredentials(
  source: SourceName,
  tokens: Record<string, string>,
  refreshToken: string,
): Record<string, string> {
  // Prefer the full tokens blob saved by /api/connectors/google/exchange.
  // Falls back to env-driven secrets if older rows only have refresh_token.
  if (Object.keys(tokens).length > 0) return tokens;

  const env = process.env;
  switch (source) {
    case "gmail":
      return {
        GMAIL_CLIENT_ID: env.GMAIL_CLIENT_ID ?? "",
        GMAIL_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET ?? "",
        GMAIL_REFRESH_TOKEN: refreshToken,
      };
    case "calendar":
      return {
        CALENDAR_CLIENT_ID:
          env.CALENDAR_CLIENT_ID ?? env.GMAIL_CLIENT_ID ?? "",
        CALENDAR_CLIENT_SECRET:
          env.CALENDAR_CLIENT_SECRET ?? env.GMAIL_CLIENT_SECRET ?? "",
        CALENDAR_REFRESH_TOKEN: refreshToken,
      };
    case "slack":
      return { SLACK_BOT_TOKEN: refreshToken };
    case "linear":
      return { LINEAR_API_KEY: refreshToken };
    case "github":
      return { GITHUB_TOKEN: refreshToken };
    case "notion":
      return { NOTION_TOKEN: refreshToken };
    case "jira":
      return {
        JIRA_EMAIL: env.JIRA_EMAIL ?? "",
        JIRA_API_TOKEN: refreshToken,
        JIRA_DOMAIN: env.JIRA_DOMAIN ?? "",
      };
    case "outlook":
      return {
        OUTLOOK_CLIENT_ID: env.OUTLOOK_CLIENT_ID ?? "",
        OUTLOOK_CLIENT_SECRET: env.OUTLOOK_CLIENT_SECRET ?? "",
        OUTLOOK_REFRESH_TOKEN: refreshToken,
        OUTLOOK_TENANT_ID: env.OUTLOOK_TENANT_ID ?? "common",
      };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeConnector(engine: any, source: SourceName) {
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
