import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MOCK_PATTERNS } from "@/lib/mock-patterns";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const minScore = Number(searchParams.get("minScore") ?? "0");
  const maxScore = Number(searchParams.get("maxScore") ?? "100");
  const sort = searchParams.get("sort") ?? "score";

  try {
    const supabase = await createClient();

    const { data: dbPatterns, error } = await supabase
      .from("patterns")
      .select("pattern_id, name, frequency, confidence, source_systems, metadata, updated_at")
      .order("confidence", { ascending: false });

    if (error || !dbPatterns || dbPatterns.length === 0) {
      return NextResponse.json(applyFilters(MOCK_PATTERNS, source, minScore, maxScore, sort));
    }

    // Fetch all pattern_events for these patterns
    const patternIds = dbPatterns.map((p) => p.pattern_id);
    const { data: dbSteps } = await supabase
      .from("pattern_events")
      .select("pattern_id, event_type, position, source_system")
      .in("pattern_id", patternIds)
      .order("position", { ascending: true });

    const stepsByPattern = new Map<string, typeof dbSteps>();
    for (const step of dbSteps ?? []) {
      const existing = stepsByPattern.get(step.pattern_id) ?? [];
      existing.push(step);
      stepsByPattern.set(step.pattern_id, existing);
    }

    const patterns = dbPatterns.map((p) => ({
      id: p.pattern_id,
      name: p.name,
      steps: (stepsByPattern.get(p.pattern_id) ?? []).map((s) => ({
        eventType: s.event_type,
        position: s.position,
        sourceSystem: s.source_system ?? "",
      })),
      compositeScore: Math.round((p.confidence ?? 0) * 100),
      breakdown: {
        frequency: 0,
        consistency: 0,
        completionRate: 0,
        automationPotential: 0,
        ...((p.metadata as Record<string, unknown>)?.breakdown as Record<string, number> ?? {}),
      },
      frequency: p.frequency ?? 0,
      lastSeen: p.updated_at ?? new Date().toISOString(),
      sources: (p.source_systems as string[]) ?? [],
      evidence: [],
    }));

    return NextResponse.json(applyFilters(patterns, source, minScore, maxScore, sort));
  } catch {
    return NextResponse.json(applyFilters(MOCK_PATTERNS, source, minScore, maxScore, sort));
  }
}

interface FilterablePattern {
  compositeScore: number;
  sources: readonly string[];
  frequency: number;
  lastSeen: string;
}

function applyFilters<T extends FilterablePattern>(
  patterns: readonly T[],
  source: string | null,
  minScore: number,
  maxScore: number,
  sort: string,
): T[] {
  const filtered = patterns.filter((p) => {
    if (source && !p.sources.includes(source)) return false;
    if (p.compositeScore < minScore || p.compositeScore > maxScore) return false;
    return true;
  });

  const sorted = [...filtered];
  switch (sort) {
    case "frequency":
      sorted.sort((a, b) => b.frequency - a.frequency);
      break;
    case "recency":
      sorted.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
      break;
    default:
      sorted.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  return sorted;
}
