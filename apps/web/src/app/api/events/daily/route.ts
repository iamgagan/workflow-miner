import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/events/daily
 *
 * Returns brain_timeline events bucketed per calendar day for the last
 * `?days=N` days (default 14). This is what the dashboard ActivityChart
 * renders — the user's actual workflow activity over time.
 *
 * Previously the chart was reading /api/activity, which only surfaces
 * the activity_log audit table (sync runs + skill exports). In desktop
 * mode that table is almost always empty, so the chart showed "Connect
 * sources to see activity" even when the brain had hundreds of events.
 * This endpoint fixes that by querying the actual event stream.
 *
 * Response shape:
 *   {
 *     "days": [
 *       { "date": "Apr  5", "iso": "2026-04-05", "events": 12, "bySource": { "gmail": 5, "slack": 7 } },
 *       ...
 *     ],
 *     "totalEvents": 142
 *   }
 *
 * Days with zero events are included so the chart X axis stays
 * continuous instead of skipping gaps.
 */

export const runtime = "nodejs";

interface DayBucket {
  date: string;
  iso: string;
  events: number;
  bySource: Record<string, number>;
}

function fmtLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Extract a YYYY-MM-DD key from either an ISO string or a Date object. */
function toIsoDate(raw: string | Date): string | null {
  if (raw instanceof Date) {
    return isoDate(raw);
  }
  if (typeof raw === "string" && raw.length >= 10) {
    return raw.slice(0, 10);
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.max(
    1,
    Math.min(90, parseInt(url.searchParams.get("days") ?? "14", 10) || 14),
  );

  try {
    const supabase = createAdminClient();

    // Compute the inclusive start of the window.
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const result = await supabase
      .from("brain_timeline")
      .select("date, source, created_at")
      .gte("date", start.toISOString())
      .order("date", { ascending: true });

    if (result.error) {
      return NextResponse.json({ days: [], totalEvents: 0 });
    }

    // PGlite returns TIMESTAMPTZ columns as JS Date objects, so we widen
    // the type to accept both and normalise below.
    const rows = (result.data ?? []) as Array<{
      date: string | Date | null;
      source: string | null;
      created_at: string | Date | null;
    }>;

    // Pre-populate the window with empty buckets so days with zero events
    // still appear on the chart X axis.
    const buckets = new Map<string, DayBucket>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = isoDate(d);
      buckets.set(iso, {
        date: fmtLabel(d),
        iso,
        events: 0,
        bySource: {},
      });
    }

    let totalEvents = 0;
    for (const row of rows) {
      const raw = row.date ?? row.created_at;
      if (!raw) continue;
      const iso = toIsoDate(raw);
      if (!iso) continue;
      const bucket = buckets.get(iso);
      if (!bucket) continue;
      bucket.events += 1;
      if (row.source) {
        bucket.bySource[row.source] = (bucket.bySource[row.source] ?? 0) + 1;
      }
      totalEvents += 1;
    }

    return NextResponse.json({
      days: Array.from(buckets.values()),
      totalEvents,
    });
  } catch (err) {
    console.error("[/api/events/daily] failed", err);
    return NextResponse.json({ days: [], totalEvents: 0 });
  }
}
