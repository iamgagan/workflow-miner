import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDesktopMode } from "@/lib/supabase/local-shim";
import { LocalBrainClient } from "@/lib/local-brain-client";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function getEngine() {
  return await import("@workflow-miner/engine");
}
type Engine = Awaited<ReturnType<typeof getEngine>>;

export const runtime = "nodejs";
export const maxDuration = 120;

type SourceName = "gmail" | "calendar" | "slack" | "linear";

const ALL_SOURCES: readonly SourceName[] = ["gmail", "calendar", "slack", "linear"];

/**
 * GET /api/cron/sync-and-mine
 *
 * Automated pipeline: sync all configured connectors, then mine patterns.
 * Runs via Vercel Cron (hourly) or any external scheduler.
 *
 * Auto-detects which connectors have credentials configured (via DB tokens
 * or environment variables) and only syncs those — no manual setup needed
 * beyond providing the API keys.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const userId = isDesktopMode() ? "local" : "cron";

  // Dynamically import engine to avoid bundling Node.js-only modules
  const engine = await getEngine();

  const brainClient = isDesktopMode()
    ? (new LocalBrainClient() as any)
    : new engine.BrainClient({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      });

  const ingestWriter = new engine.IngestWriter(brainClient);
  const normalizer = new engine.Normalizer();
  const syncResults: Record<string, { events: number; status: string; error?: string }> = {};

  // ── Step 1: Sync all configured sources ────────────────────────────

  for (const source of ALL_SOURCES) {
    try {
      const credentials = await loadCredentials(source, userId, supabase);
      if (!hasRequiredCredentials(source, credentials)) {
        syncResults[source] = { events: 0, status: "skipped" };
        continue;
      }

      const connector = createConnector(source, engine);
      const rawEvents = await connector.fetchEvents({
        credentials,
        lookbackDays: 14,
      });

      const { events: normalizedEvents } = normalizer.normalize(rawEvents);
      await ingestWriter.writeEvents(normalizedEvents);

      syncResults[source] = { events: normalizedEvents.length, status: "ok" };
    } catch (err) {
      syncResults[source] = {
        events: 0,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const totalEvents = Object.values(syncResults).reduce((s, r) => s + r.events, 0);
  const syncedSources = Object.entries(syncResults)
    .filter(([, r]) => r.status === "ok")
    .map(([name]) => name);

  console.log(
    `[cron/sync-and-mine] sync: ${totalEvents} events from [${syncedSources.join(", ") || "none"}]`,
  );

  // ── Step 2: Mine patterns ──────────────────────────────────────────

  let patternsCount = 0;
  let mineError: string | undefined;

  if (totalEvents > 0 || syncedSources.length > 0) {
    try {
      // Re-use the patterns/mine logic inline: read timeline, sessionize, mine, score, write
      const { data: timelineEntries } = await supabase
        .from("brain_timeline")
        .select("id, source, summary, date, detail")
        .order("date", { ascending: true });

      if (timelineEntries && timelineEntries.length > 0) {
        const eventRows = timelineEntries.map((entry: Record<string, unknown>) => ({
          event_id: String(entry.id),
          source_system: (entry.source as string) ?? "unknown",
          source_object_type: "timeline",
          source_object_id: String(entry.id),
          actor_id: userId,
          timestamp: entry.date as string,
          workspace_id: null,
          conversation_id: null,
          entity_refs: "[]",
          event_type: inferEventType(entry.source as string, entry.summary as string),
          content_text: entry.summary as string,
          metadata: "{}",
          parent_event_id: null,
          causal_links: "[]",
          confidence: 1.0,
          pii_redaction_state: "none",
          created_at: entry.date as string,
        }));

        const sessionizer = new engine.Sessionizer({ gapThresholdMs: 4 * 60 * 60 * 1000 });
        const sessions = sessionizer.groupEvents(eventRows);

        const sequences = sessions.map((s: any) => ({
          sessionId: s.sessionId,
          events: s.events.map((e: any) => ({
            eventType: e.event_type,
            timestamp: e.timestamp,
          })),
        }));

        const miner = new engine.PatternMiner();
        const patterns = miner.mine(sequences, { minSupport: 2, minLength: 2, maxLength: 8 });

        const scorer = new engine.PatternScorer();
        const scored = patterns.map((p: any) => {
          const candidate = {
            id: p.id ?? `pattern-${p.steps.join("-")}`,
            name: p.steps.join(" \u2192 "),
            steps: p.steps,
            instances: p.exampleSessions.map(() => ({
              eventTypes: p.steps,
              completed: true,
            })),
          };
          return { scored: scorer.score(candidate), candidate };
        });

        // Write patterns to brain as workflow pages
        for (const { scored: s, candidate: c } of scored) {
          const slug = `workflows/${c.id}`;
          await supabase.from("brain_pages").upsert(
            {
              slug,
              type: "workflow",
              title: c.name,
              compiled_truth: `${c.steps.length}-step workflow detected ${c.instances.length} times`,
              frontmatter: {
                confidence: s.compositeScore,
                breakdown: s.breakdown,
                steps: c.steps,
                frequency: c.instances.length,
              },
            },
            { onConflict: "slug" },
          );
        }

        patternsCount = scored.length;
        console.log(`[cron/sync-and-mine] mine: ${patternsCount} patterns`);
      }
    } catch (err) {
      mineError = err instanceof Error ? err.message : String(err);
      console.error("[cron/sync-and-mine] mine failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    sync: {
      totalEvents,
      sources: syncResults,
    },
    mine: {
      patterns: patternsCount,
      ...(mineError ? { error: mineError } : {}),
    },
  });
}

// ── Helpers (shared with sync route) ──────────────────────────────────

function inferEventType(source: string, summary: string): string {
  const lower = (summary ?? "").toLowerCase();
  if (lower.includes("created") || lower.includes("opened")) return "issue_created";
  if (lower.includes("closed") || lower.includes("merged")) return "issue_closed";
  if (lower.includes("comment")) return "comment_added";
  if (lower.includes("review")) return "review_submitted";
  if (lower.includes("meeting") || lower.includes("calendar")) return "meeting_scheduled";
  if (source === "gmail") return "message_received";
  if (source === "slack") return "message_sent";
  if (source === "linear") return "issue_updated";
  if (source === "calendar") return "meeting_scheduled";
  return "message_received";
}

async function loadCredentials(
  source: SourceName,
  userId: string,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Record<string, string>> {
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
    // Table may not exist yet
  }

  // Path 1: tokens JSONB blob
  if (row?.tokens && typeof row.tokens === "object") {
    const tokens = row.tokens as Record<string, string>;
    if (Object.keys(tokens).length > 0) return tokens;
  }

  // Path 2: OAuth columns + env credentials
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
          CALENDAR_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET ?? env.CALENDAR_CLIENT_SECRET ?? "",
          CALENDAR_REFRESH_TOKEN: refreshToken,
        };
      case "slack":
        return { SLACK_BOT_TOKEN: refreshToken, SLACK_CHANNEL_IDS: env.SLACK_CHANNEL_IDS ?? "" };
      case "linear":
        return { LINEAR_API_KEY: refreshToken };
    }
  }

  // Path 3: Pure environment variables
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
      return { LINEAR_API_KEY: env.LINEAR_API_KEY ?? "" };
  }
}

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
  }
}

function createConnector(source: SourceName, engine: Engine) {
  switch (source) {
    case "gmail": return new engine.GmailConnector();
    case "calendar": return new engine.CalendarConnector();
    case "slack": return new engine.SlackConnector();
    case "linear": return new engine.LinearConnector();
  }
}
