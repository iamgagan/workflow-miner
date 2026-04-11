import type { BrainPage, BrainLink, BrainStats, TimelineEntry, PageType } from './types.js';

interface BrainClientConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

function getConfig(): BrainClientConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
    );
  }

  return { supabaseUrl, supabaseServiceRoleKey };
}

/**
 * Lightweight gbrain-compatible client that talks directly to Supabase
 * Postgres via the PostgREST API. No additional dependencies required.
 */
export class BrainClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config?: BrainClientConfig) {
    const { supabaseUrl, supabaseServiceRoleKey } = config ?? getConfig();
    this.baseUrl = `${supabaseUrl}/rest/v1`;
    this.headers = {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
  }

  // ── Pages ──────────────────────────────────────────────────────────

  async putPage(page: {
    slug: string;
    type?: PageType;
    title: string;
    compiled_truth?: string;
    timeline?: string;
    frontmatter?: Record<string, unknown>;
    content_hash?: string;
  }): Promise<BrainPage> {
    // Upsert by slug
    const response = await fetch(`${this.baseUrl}/brain_pages`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify({
        slug: page.slug,
        type: page.type ?? 'concept',
        title: page.title,
        compiled_truth: page.compiled_truth ?? '',
        timeline: page.timeline ?? '',
        frontmatter: page.frontmatter ?? {},
        content_hash: page.content_hash ?? null,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`putPage failed (${response.status}): ${text}`);
    }

    const rows = (await response.json()) as BrainPage[];
    return rows[0];
  }

  async getPage(slug: string): Promise<BrainPage | null> {
    const response = await fetch(
      `${this.baseUrl}/brain_pages?slug=eq.${encodeURIComponent(slug)}&limit=1`,
      { headers: this.headers }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`getPage failed (${response.status}): ${text}`);
    }

    const rows = (await response.json()) as BrainPage[];
    return rows[0] ?? null;
  }

  async listPages(options?: {
    type?: PageType;
    limit?: number;
    offset?: number;
  }): Promise<BrainPage[]> {
    const params = new URLSearchParams();
    if (options?.type) params.set('type', `eq.${options.type}`);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    params.set('order', 'updated_at.desc');

    const response = await fetch(
      `${this.baseUrl}/brain_pages?${params.toString()}`,
      { headers: this.headers }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`listPages failed (${response.status}): ${text}`);
    }

    return (await response.json()) as BrainPage[];
  }

  async search(query: string, options?: { limit?: number }): Promise<BrainPage[]> {
    // Full-text search across title and compiled_truth using PostgREST ilike
    const encoded = encodeURIComponent(`%${query}%`);
    const limit = options?.limit ?? 20;
    const response = await fetch(
      `${this.baseUrl}/brain_pages?or=(title.ilike.${encoded},compiled_truth.ilike.${encoded})&limit=${limit}&order=updated_at.desc`,
      { headers: this.headers }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`search failed (${response.status}): ${text}`);
    }

    return (await response.json()) as BrainPage[];
  }

  // ── Stats ──────────────────────────────────────────────────────────

  async getStats(): Promise<BrainStats> {
    const response = await fetch(`${this.baseUrl}/brain_stats?limit=1`, {
      headers: this.headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`getStats failed (${response.status}): ${text}`);
    }

    const rows = (await response.json()) as BrainStats[];
    return rows[0] ?? { page_count: 0, timeline_count: 0, link_count: 0, tag_count: 0 };
  }

  // ── Timeline ───────────────────────────────────────────────────────

  async addTimelineEntry(entry: {
    page_id: number;
    date: string;
    source: string;
    summary: string;
    detail?: string;
  }): Promise<TimelineEntry> {
    const response = await fetch(`${this.baseUrl}/brain_timeline`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        page_id: entry.page_id,
        date: entry.date,
        source: entry.source,
        summary: entry.summary,
        detail: entry.detail ?? '',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`addTimelineEntry failed (${response.status}): ${text}`);
    }

    const rows = (await response.json()) as TimelineEntry[];
    return rows[0];
  }

  async getTimeline(pageId: number, options?: {
    limit?: number;
    offset?: number;
  }): Promise<TimelineEntry[]> {
    const params = new URLSearchParams();
    params.set('page_id', `eq.${pageId}`);
    params.set('order', 'date.desc');
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const response = await fetch(
      `${this.baseUrl}/brain_timeline?${params.toString()}`,
      { headers: this.headers }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`getTimeline failed (${response.status}): ${text}`);
    }

    return (await response.json()) as TimelineEntry[];
  }

  // ── Links ──────────────────────────────────────────────────────────

  async addLink(link: {
    from_slug: string;
    to_slug: string;
    link_type?: string;
    context?: string;
  }): Promise<BrainLink> {
    const response = await fetch(`${this.baseUrl}/brain_links`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify({
        from_slug: link.from_slug,
        to_slug: link.to_slug,
        link_type: link.link_type ?? 'related',
        context: link.context ?? '',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`addLink failed (${response.status}): ${text}`);
    }

    const rows = (await response.json()) as BrainLink[];
    return rows[0];
  }
}
