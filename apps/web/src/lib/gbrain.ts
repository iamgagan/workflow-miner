import { createClient } from "@/lib/supabase/server";

export interface BrainPage {
  readonly id: string;
  readonly slug: string;
  readonly type: string;
  readonly title: string;
  readonly compiled_truth: string | null;
  readonly timeline: unknown;
  readonly frontmatter: Record<string, unknown> | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BrainTimelineEntry {
  readonly id: string;
  readonly page_id: string;
  readonly date: string;
  readonly source: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly created_at: string;
}

export interface BrainLink {
  readonly from_slug: string;
  readonly to_slug: string;
  readonly link_type: string;
  readonly context: string | null;
  readonly created_at: string;
}

export interface GBrainStats {
  totalEvents: number;
  activePatterns: number;
  skillsExported: number;
  dataSources: number;
  totalSources: number;
  /** % change in events vs the previous 7-day window. null when there's
   * no previous-week data to compare against. */
  eventsDeltaPct: number | null;
  /** Most recent ingest timestamp (ISO) seen in the timeline. null if
   * the brain is empty. */
  lastIngestAt: string | null;
}

export async function getGBrainStats(): Promise<GBrainStats> {
  const empty: GBrainStats = {
    totalEvents: 0,
    activePatterns: 0,
    skillsExported: 0,
    dataSources: 0,
    totalSources: 4,
    eventsDeltaPct: null,
    lastIngestAt: null,
  };

  try {
    const supabase = await createClient();

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [
      timelineRes,
      pagesRes,
      sourcesRes,
      exportsRes,
      thisWeekRes,
      lastWeekRes,
      latestRes,
    ] = await Promise.all([
      supabase
        .from("brain_timeline")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("brain_pages")
        .select("*", { count: "exact", head: true })
        .in("type", ["concept", "workflow"]),
      supabase
        .from("brain_timeline")
        .select("source")
        .limit(1000),
      // Count real skill exports recorded by /api/skills/[id]/export.
      // The activity_log table is best-effort; if it doesn't exist (legacy
      // hosted deployments) we just report 0.
      supabase
        .from("activity_log")
        .select("*", { count: "exact", head: true })
        .eq("type", "export"),
      // Events in the last 7 days, for the week-over-week delta on the
      // Total Events stat card.
      supabase
        .from("brain_timeline")
        .select("*", { count: "exact", head: true })
        .gte("date", weekAgo.toISOString()),
      // Events in the 7 days before that.
      supabase
        .from("brain_timeline")
        .select("*", { count: "exact", head: true })
        .gte("date", twoWeeksAgo.toISOString())
        .lt("date", weekAgo.toISOString()),
      // Most recent timeline row, for the "last ingest" hint.
      supabase
        .from("brain_timeline")
        .select("date, created_at")
        .order("date", { ascending: false })
        .limit(1),
    ]);

    if (timelineRes.error || pagesRes.error) {
      return empty;
    }

    const totalEvents = timelineRes.count ?? 0;
    const activePatterns = pagesRes.count ?? 0;
    const skillsExported = exportsRes?.error ? 0 : (exportsRes?.count ?? 0);
    const distinctSources = new Set(
      ((sourcesRes.data as Array<{ source: string | null }>) ?? [])
        .map((e) => e.source)
        .filter((s): s is string => Boolean(s)),
    );

    // Week-over-week delta. null when the previous week was empty (a 100%
    // increase from 0 is meaningless to show).
    const thisWeek = thisWeekRes?.error ? 0 : (thisWeekRes?.count ?? 0);
    const lastWeek = lastWeekRes?.error ? 0 : (lastWeekRes?.count ?? 0);
    const eventsDeltaPct =
      lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;

    const latestRow =
      (latestRes?.data as Array<{ date: string | null; created_at: string | null }> | null)?.[0] ??
      null;
    const lastIngestAt = latestRow ? latestRow.date ?? latestRow.created_at : null;

    return {
      totalEvents,
      activePatterns,
      skillsExported,
      dataSources: distinctSources.size,
      totalSources: 4,
      eventsDeltaPct,
      lastIngestAt,
    };
  } catch {
    return empty;
  }
}

export async function listPatterns(limit = 20): Promise<
  Array<{
    id: string;
    name: string;
    steps: Array<{ eventType: string; position: number; sourceSystem: string }>;
    compositeScore: number;
    breakdown: {
      frequency: number;
      consistency: number;
      completionRate: number;
      automationPotential: number;
    };
    frequency: number;
    lastSeen: string;
    sources: string[];
    evidence: Array<Record<string, unknown>>;
  }>
> {
  try {
    const supabase = await createClient();

    const { data: pages, error } = await supabase
      .from("brain_pages")
      .select("id, slug, type, title, compiled_truth, frontmatter, created_at, updated_at")
      .in("type", ["concept", "workflow"])
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error || !pages || pages.length === 0) {
      return [];
    }

    // Fetch links for these pages to derive sources
    const slugs = pages.map((p) => p.slug);
    const { data: links } = await supabase
      .from("brain_links")
      .select("from_slug, to_slug, link_type")
      .in("from_slug", slugs);

    const linksBySlug = new Map<string, Array<{ from_slug: string; to_slug: string; link_type: string }>>();
    for (const link of links ?? []) {
      const existing = linksBySlug.get(link.from_slug) ?? [];
      existing.push(link);
      linksBySlug.set(link.from_slug, existing);
    }

    // Fetch timeline counts per page for frequency
    const pageIds = pages.map((p) => p.id);
    const { data: timelineEntries } = await supabase
      .from("brain_timeline")
      .select("page_id, source")
      .in("page_id", pageIds);

    const timelineByPage = new Map<string, Array<{ source: string }>>();
    for (const entry of timelineEntries ?? []) {
      const existing = timelineByPage.get(entry.page_id) ?? [];
      existing.push({ source: entry.source });
      timelineByPage.set(entry.page_id, existing);
    }

    return pages.map((page) => {
      const pageTimeline = timelineByPage.get(page.id) ?? [];
      const frontmatter = (page.frontmatter ?? {}) as Record<string, unknown>;
      // Prefer sources persisted in the frontmatter by /api/patterns/mine
      // (derived from the evidence events) over the link-based lookup,
      // which doesn't work for mined patterns.
      const frontmatterSources = Array.isArray(frontmatter.sources)
        ? (frontmatter.sources as string[]).filter((s) => typeof s === "string")
        : null;
      const linkBasedSources = [
        ...new Set(pageTimeline.map((t) => t.source).filter(Boolean)),
      ];
      const pageSources = frontmatterSources ?? linkBasedSources;

      // Prefer steps stored in frontmatter (from PatternMiner) over link-derived steps
      const frontmatterSteps = Array.isArray(frontmatter.steps)
        ? (frontmatter.steps as Array<{ eventType: string; position: number; sourceSystem: string | null }>).map(
            (s) => ({
              eventType: s.eventType,
              position: s.position,
              sourceSystem: s.sourceSystem ?? "",
            }),
          )
        : null;

      const linkSteps = (linksBySlug.get(page.slug) ?? []).map((link, pos) => ({
        eventType: link.link_type,
        position: pos,
        sourceSystem: link.to_slug,
      }));

      const support = typeof frontmatter.support === "number" ? frontmatter.support : 0;
      const breakdown = readBreakdown(frontmatter);
      const compositeScore = readCompositeScore(frontmatter);

      return {
        id: page.slug,
        name: page.title,
        steps: frontmatterSteps ?? linkSteps,
        compositeScore,
        breakdown,
        frequency: support > 0 ? support : pageTimeline.length,
        lastSeen: page.updated_at ?? page.created_at ?? new Date().toISOString(),
        sources: pageSources.length > 0 ? pageSources : [],
        evidence: [],
      };
    });
  } catch {
    return [];
  }
}

/**
 * Resolve a composite score from a brain_pages frontmatter blob.
 *
 * The mine route now writes a real 0..100 `compositeScore` field computed
 * by PatternScorer. Older pages (seed workflows, pre-upgrade) only have
 * `confidence: 0..1`. We prefer the real score and fall back to scaling
 * confidence for backwards compat.
 */
function readCompositeScore(frontmatter: Record<string, unknown>): number {
  if (typeof frontmatter.compositeScore === "number") {
    return Math.round(frontmatter.compositeScore);
  }
  const confidence =
    typeof frontmatter.confidence === "number" ? frontmatter.confidence : 0.5;
  return Math.round(confidence * 100);
}

/**
 * Normalise the 4-dimension breakdown from frontmatter. Fills in zeros
 * for any missing dimension so the UI radar chart always has a full set
 * of axes.
 */
function readBreakdown(frontmatter: Record<string, unknown>): {
  frequency: number;
  consistency: number;
  completionRate: number;
  automationPotential: number;
} {
  const raw = (frontmatter.breakdown ?? {}) as Record<string, unknown>;
  const num = (k: string): number =>
    typeof raw[k] === "number" ? (raw[k] as number) : 0;
  return {
    frequency: num("frequency"),
    consistency: num("consistency"),
    completionRate: num("completionRate"),
    automationPotential: num("automationPotential"),
  };
}

export async function getPattern(slug: string): Promise<{
  id: string;
  name: string;
  steps: Array<{ eventType: string; position: number; sourceSystem: string }>;
  compositeScore: number;
  breakdown: {
    frequency: number;
    consistency: number;
    completionRate: number;
    automationPotential: number;
  };
  frequency: number;
  lastSeen: string;
  sources: string[];
  evidence: Array<Record<string, unknown>>;
} | null> {
  try {
    const supabase = await createClient();

    const { data: page, error } = await supabase
      .from("brain_pages")
      .select("id, slug, type, title, compiled_truth, frontmatter, created_at, updated_at")
      .eq("slug", slug)
      .single();

    if (error || !page) {
      return null;
    }

    const [linksRes, timelineRes] = await Promise.all([
      supabase
        .from("brain_links")
        .select("from_slug, to_slug, link_type")
        .eq("from_slug", slug),
      supabase
        .from("brain_timeline")
        .select("page_id, source")
        .eq("page_id", page.id),
    ]);

    const links = linksRes.data ?? [];
    const timeline = timelineRes.data ?? [];
    const frontmatter = (page.frontmatter ?? {}) as Record<string, unknown>;
    const frontmatterSources = Array.isArray(frontmatter.sources)
      ? (frontmatter.sources as string[]).filter((s) => typeof s === "string")
      : null;
    const linkBasedSources = [
      ...new Set(timeline.map((t) => t.source).filter(Boolean)),
    ];
    const sources = frontmatterSources ?? linkBasedSources;

    // Prefer frontmatter.steps (mined patterns) over link-derived steps
    // (legacy hand-authored workflow pages). Without this, mined pattern
    // detail pages had empty step lists because nothing was writing
    // brain_links rows for them.
    const frontmatterSteps = Array.isArray(frontmatter.steps)
      ? (frontmatter.steps as Array<{ eventType: string; position: number; sourceSystem: string | null }>).map(
          (s) => ({
            eventType: s.eventType,
            position: s.position,
            sourceSystem: s.sourceSystem ?? "",
          }),
        )
      : null;

    const linkSteps = links.map((link, pos) => ({
      eventType: link.link_type,
      position: pos,
      sourceSystem: link.to_slug,
    }));

    return {
      id: page.slug,
      name: page.title,
      steps: frontmatterSteps ?? linkSteps,
      compositeScore: readCompositeScore(frontmatter),
      breakdown: readBreakdown(frontmatter),
      frequency:
        typeof frontmatter.support === "number"
          ? frontmatter.support
          : timeline.length,
      lastSeen: page.updated_at ?? page.created_at ?? new Date().toISOString(),
      sources,
      evidence: [],
    };
  } catch {
    return null;
  }
}

export async function getPatternEvidence(slug: string): Promise<
  Array<{
    id: string;
    type: string;
    source: string;
    timestamp: string;
    summary: string;
    actor: string;
  }>
> {
  try {
    const supabase = await createClient();

    // Fetch the workflow page including its frontmatter so we can read the
    // evidenceEventIds list written by /api/patterns/mine.
    const { data: page, error: pageError } = await supabase
      .from("brain_pages")
      .select("id, frontmatter")
      .eq("slug", slug)
      .single();

    if (pageError || !page) {
      return [];
    }

    // Resolution order:
    //   1. evidenceEventIds in frontmatter — written by the miner so the
    //      evidence panel shows the actual events that contributed to the
    //      pattern. This is the canonical path.
    //   2. Legacy: timeline entries linked to the workflow page_id (kept
    //      for compatibility with hand-authored workflow pages).
    const frontmatter = (page.frontmatter ?? {}) as Record<string, unknown>;
    const evidenceIds = Array.isArray(frontmatter.evidenceEventIds)
      ? (frontmatter.evidenceEventIds as string[])
      : [];

    if (evidenceIds.length > 0) {
      const { data: byIdEntries } = await supabase
        .from("brain_timeline")
        .select("id, page_id, date, source, summary, detail, created_at")
        .in("id", evidenceIds);

      if (byIdEntries && byIdEntries.length > 0) {
        // Preserve the step order recorded by the miner instead of the
        // database's natural row order.
        const byId = new Map(
          (byIdEntries as Array<Record<string, unknown>>).map((row) => [
            String(row.id),
            row,
          ]),
        );
        return evidenceIds
          .map((id) => byId.get(String(id)))
          .filter((row): row is Record<string, unknown> => Boolean(row))
          .map((e) => ({
            id: String(e.id),
            type: (e.source as string) ?? "event",
            source: (e.source as string) ?? "unknown",
            timestamp: (e.date as string) ?? (e.created_at as string),
            summary: (e.summary as string) ?? "Timeline entry",
            actor: "",
          }));
      }
    }

    // Legacy fallback: timeline entries linked by page_id.
    const { data: entries, error } = await supabase
      .from("brain_timeline")
      .select("id, page_id, date, source, summary, detail, created_at")
      .eq("page_id", page.id)
      .order("date", { ascending: false })
      .limit(20);

    if (error || !entries) {
      return [];
    }

    return entries.map((e) => ({
      id: e.id,
      type: e.source ?? "event",
      source: e.source ?? "unknown",
      timestamp: e.date ?? e.created_at,
      summary: e.summary ?? "Timeline entry",
      actor: "",
    }));
  } catch {
    return [];
  }
}

export async function searchBrain(query: string, limit = 10): Promise<BrainPage[]> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("brain_pages")
      .select("id, slug, type, title, compiled_truth, frontmatter, created_at, updated_at")
      .or(`title.ilike.%${query}%,compiled_truth.ilike.%${query}%`)
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data as BrainPage[];
  } catch {
    return [];
  }
}
