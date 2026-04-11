import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const [eventsRes, patternsRes, skillsRes, sourcesRes] = await Promise.all([
      supabase.from("events").select("*", { count: "exact", head: true }),
      supabase.from("patterns").select("*", { count: "exact", head: true }),
      supabase.from("skills_exported").select("*", { count: "exact", head: true }),
      supabase.from("events").select("source_system").limit(1000),
    ]);

    const totalEvents = eventsRes.count ?? 0;
    const activePatterns = patternsRes.count ?? 0;
    const skillsExported = skillsRes.count ?? 0;
    const distinctSources = new Set(
      (sourcesRes.data ?? []).map((e) => e.source_system),
    );
    const dataSources = distinctSources.size;

    return NextResponse.json({
      totalEvents,
      activePatterns,
      skillsExported,
      dataSources,
      totalSources: 4,
    });
  } catch {
    return NextResponse.json({
      totalEvents: 0,
      activePatterns: 0,
      skillsExported: 0,
      dataSources: 0,
      totalSources: 4,
    });
  }
}
