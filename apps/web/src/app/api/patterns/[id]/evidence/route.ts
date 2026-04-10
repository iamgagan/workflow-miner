import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPatternById } from "@/lib/mock-patterns";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const supabase = await createClient();

    // Get pattern_events to find the event types for this pattern
    const { data: patternEvents, error } = await supabase
      .from("pattern_events")
      .select("event_type, source_system")
      .eq("pattern_id", id)
      .order("position", { ascending: true });

    if (error || !patternEvents || patternEvents.length === 0) {
      const mock = getPatternById(id);
      if (!mock) return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
      return NextResponse.json(mock.evidence);
    }

    // Fetch recent events matching these event types as evidence
    const eventTypes = patternEvents.map((pe) => pe.event_type);
    const { data: events } = await supabase
      .from("events")
      .select("event_id, event_type, source_system, timestamp, content_text, actor_id")
      .in("event_type", eventTypes)
      .order("timestamp", { ascending: false })
      .limit(20);

    if (!events || events.length === 0) {
      const mock = getPatternById(id);
      if (!mock) return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
      return NextResponse.json(mock.evidence);
    }

    const evidence = events.map((e) => ({
      id: e.event_id,
      type: e.event_type,
      source: e.source_system,
      timestamp: e.timestamp,
      summary: e.content_text ?? `${e.event_type} event`,
      actor: e.actor_id,
    }));

    return NextResponse.json(evidence);
  } catch {
    const mock = getPatternById(id);
    if (!mock) return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
    return NextResponse.json(mock.evidence);
  }
}
