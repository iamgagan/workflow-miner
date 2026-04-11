import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/sources
 *
 * Returns connection status + event counts for each connector source.
 * Used by the dashboard `SourceStatus` card so the renderer never has to
 * talk to Supabase (or PGlite) directly. Works in both hosted and desktop
 * modes via the env-gated admin client factory.
 *
 * Response shape:
 *   {
 *     "sources": [
 *       { "key": "gmail",    "connected": true,  "lastSync": "...", "eventCount": 142 },
 *       { "key": "calendar", "connected": true,  "lastSync": "...", "eventCount": 23  },
 *       { "key": "slack",    "connected": false, "lastSync": null,  "eventCount": 0   },
 *       { "key": "linear",   "connected": false, "lastSync": null,  "eventCount": 0   }
 *     ]
 *   }
 */

export const runtime = "nodejs";

interface SourceStatus {
  key: string;
  connected: boolean;
  lastSync: string | null;
  eventCount: number;
}

const SOURCE_KEYS = ["gmail", "calendar", "slack", "linear"] as const;
type SourceKey = (typeof SOURCE_KEYS)[number];

export async function GET() {
  try {
    const supabase = createAdminClient();

    const [tokensRes, timelineRes] = await Promise.all([
      supabase
        .from("connector_tokens")
        .select("provider, updated_at, tokens, access_token"),
      supabase.from("brain_timeline").select("source").limit(5000),
    ]);

    // Build a connection lookup keyed by source name. The Google OAuth flow
    // stores a single row under provider="google" that satisfies both
    // gmail and calendar.
    const connected = new Map<SourceKey, string>();
    for (const row of (tokensRes.data ?? []) as Array<{
      provider: string;
      updated_at: string;
      tokens?: Record<string, string>;
      access_token?: string | null;
    }>) {
      // A row counts as "connected" only if it actually contains a token —
      // a soft-disconnect via DELETE leaves the row but blanks the fields.
      const hasMaterial =
        (row.tokens && Object.keys(row.tokens).length > 0) ||
        Boolean(row.access_token);
      if (!hasMaterial) continue;

      if (row.provider === "google") {
        connected.set("gmail", row.updated_at);
        connected.set("calendar", row.updated_at);
      } else if (
        row.provider === "slack" ||
        row.provider === "linear" ||
        row.provider === "gmail" ||
        row.provider === "calendar"
      ) {
        connected.set(row.provider as SourceKey, row.updated_at);
      }
    }

    // Count events per source name in the timeline.
    const counts = new Map<string, number>();
    for (const row of (timelineRes.data ?? []) as Array<{ source: string | null }>) {
      if (!row.source) continue;
      counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    }

    const sources: SourceStatus[] = SOURCE_KEYS.map((key) => ({
      key,
      connected: connected.has(key) || (counts.get(key) ?? 0) > 0,
      lastSync: connected.get(key) ?? null,
      eventCount: counts.get(key) ?? 0,
    }));

    return NextResponse.json({ sources });
  } catch (err) {
    console.error("[/api/sources] failed", err);
    // Return all-empty so the UI degrades gracefully rather than 500ing.
    return NextResponse.json({
      sources: SOURCE_KEYS.map((key) => ({
        key,
        connected: false,
        lastSync: null,
        eventCount: 0,
      })),
    });
  }
}
