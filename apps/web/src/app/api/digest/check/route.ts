import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/digest/check?lastViewed=ISO
 *
 * Returns whether a weekly digest is available for the user.
 * Available means:
 *   1. brain_timeline has events in the last 7 days, AND
 *   2. The user hasn't viewed the digest this week (determined by the
 *      optional `lastViewed` query param — an ISO timestamp stored in
 *      localStorage by the client).
 *
 * Response: { available: boolean, weekStart: string, weekEnd: string,
 *             eventCount: number, sourceCount: number }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lastViewedParam = searchParams.get("lastViewed");

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Format dates the same way the digest route does
  function formatDate(d: Date): string {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const weekStart = formatDate(weekAgo);
  const weekEnd = formatDate(now);

  // Check if the user already viewed a digest this week
  if (lastViewedParam) {
    try {
      const lastViewed = new Date(lastViewedParam);
      // "This week" means since the start of the current Mon–Sun ISO week
      const startOfWeek = new Date(now);
      const dayOfWeek = startOfWeek.getDay(); // 0=Sun
      startOfWeek.setDate(startOfWeek.getDate() - ((dayOfWeek + 6) % 7));
      startOfWeek.setHours(0, 0, 0, 0);
      if (lastViewed >= startOfWeek) {
        return NextResponse.json({ available: false, weekStart, weekEnd, eventCount: 0, sourceCount: 0 });
      }
    } catch {
      // Invalid ISO — ignore and continue
    }
  }

  try {
    const supabase = createAdminClient();

    const { data: events, error } = await supabase
      .from("brain_timeline")
      .select("id, source")
      .gte("date", weekAgo.toISOString())
      .limit(500);

    if (error || !events || events.length === 0) {
      return NextResponse.json({ available: false, weekStart, weekEnd, eventCount: 0, sourceCount: 0 });
    }

    const eventCount = events.length;
    const sourceCount = new Set(events.map((e: { source: string }) => e.source).filter(Boolean)).size;

    return NextResponse.json({ available: true, weekStart, weekEnd, eventCount, sourceCount });
  } catch {
    return NextResponse.json({ available: false, weekStart, weekEnd, eventCount: 0, sourceCount: 0 });
  }
}
