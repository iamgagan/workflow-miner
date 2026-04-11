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

export async function getGBrainStats(): Promise<{
  totalEvents: number;
  activePatterns: number;
  skillsExported: number;
  dataSources: number;
  totalSources: number;
}> {
  try {
    const supabase = await createClient();

    const [timelineRes, pagesRes, sourcesRes] = await Promise.all([
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
    ]);

    if (timelineRes.error || pagesRes.error) {
      return { totalEvents: 0, activePatterns: 0, skillsExported: 0, dataSources: 0, totalSources: 4 };
    }

    const totalEvents = timelineRes.count ?? 0;
    const activePatterns = pagesRes.count ?? 0;
    const distinctSources = new Set(
      (sourcesRes.data ?? []).map((e) => e.source).filter(Boolean),
    );

    return {
      totalEvents,
      activePatterns,
      skillsExported: 0,
      dataSources: distinctSources.size,
      totalSources: 4,
    };
  } catch {
    return { totalEvents: 0, activePatterns: 0, skillsExported: 0, dataSources: 0, totalSources: 4 };
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

    return pages.map((page, index) => {
      const pageTimeline = timelineByPage.get(page.id) ?? [];
      const pageSources = [...new Set(pageTimeline.map((t) => t.source).filter(Boolean))];
      const frontmatter = (page.frontmatter ?? {}) as Record<string, unknown>;
      const breakdown = (frontmatter.breakdown ?? {}) as Record<string, number>;
      const confidence = typeof frontmatter.confidence === "number" ? frontmatter.confidence : 0.5;

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

      return {
        id: page.slug,
        name: page.title,
        steps: frontmatterSteps ?? linkSteps,
        compositeScore: Math.round(confidence * 100),
        breakdown: {
          frequency: support,
          consistency: 0,
          completionRate: 0,
          automationPotential: 0,
          ...breakdown,
        },
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
    const sources = [...new Set(timeline.map((t) => t.source).filter(Boolean))];
    const frontmatter = (page.frontmatter ?? {}) as Record<string, unknown>;
    const breakdown = (frontmatter.breakdown ?? {}) as Record<string, number>;
    const confidence = typeof frontmatter.confidence === "number" ? frontmatter.confidence : 0.5;

    return {
      id: page.slug,
      name: page.title,
      steps: links.map((link, pos) => ({
        eventType: link.link_type,
        position: pos,
        sourceSystem: link.to_slug,
      })),
      compositeScore: Math.round(confidence * 100),
      breakdown: {
        frequency: 0,
        consistency: 0,
        completionRate: 0,
        automationPotential: 0,
        ...breakdown,
      },
      frequency: timeline.length,
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

    const { data: page, error: pageError } = await supabase
      .from("brain_pages")
      .select("id")
      .eq("slug", slug)
      .single();

    if (pageError || !page) {
      return [];
    }

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
