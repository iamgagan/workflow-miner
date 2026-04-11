import { NextResponse } from "next/server";
import { listPatterns } from "@/lib/gbrain";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const minScore = Number(searchParams.get("minScore") ?? "0");
  const maxScore = Number(searchParams.get("maxScore") ?? "100");
  const sort = searchParams.get("sort") ?? "score";

  const brainPatterns = await listPatterns();
  return NextResponse.json(applyFilters(brainPatterns, source, minScore, maxScore, sort));
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
