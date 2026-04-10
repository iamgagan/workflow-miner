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

    const { data: pattern, error } = await supabase
      .from("patterns")
      .select("pattern_id, name, frequency, confidence, source_systems, metadata, updated_at")
      .eq("pattern_id", id)
      .single();

    if (error || !pattern) {
      const mock = getPatternById(id);
      if (!mock) return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
      return NextResponse.json(mock);
    }

    const { data: dbSteps } = await supabase
      .from("pattern_events")
      .select("event_type, position, source_system")
      .eq("pattern_id", id)
      .order("position", { ascending: true });

    return NextResponse.json({
      id: pattern.pattern_id,
      name: pattern.name,
      steps: (dbSteps ?? []).map((s) => ({
        eventType: s.event_type,
        position: s.position,
        sourceSystem: s.source_system ?? "",
      })),
      compositeScore: Math.round((pattern.confidence ?? 0) * 100),
      breakdown: {
        frequency: 0,
        consistency: 0,
        completionRate: 0,
        automationPotential: 0,
        ...((pattern.metadata as Record<string, unknown>)?.breakdown as Record<string, number> ?? {}),
      },
      frequency: pattern.frequency ?? 0,
      lastSeen: pattern.updated_at ?? new Date().toISOString(),
      sources: (pattern.source_systems as string[]) ?? [],
      evidence: [],
    });
  } catch {
    const mock = getPatternById(id);
    if (!mock) return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
    return NextResponse.json(mock);
  }
}
