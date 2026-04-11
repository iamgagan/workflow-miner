/**
 * Local-mode replacement for `@workflow-miner/engine` `BrainClient`.
 *
 * The engine's BrainClient talks to Supabase via the PostgREST API. In desktop
 * mode there is no Supabase — the brain lives in the local PGlite database
 * exposed by `lib/supabase/local-shim.ts`. This adapter implements the small
 * surface that `IngestWriter` actually calls (`putPage`, `addTimelineEntry`,
 * `addLink`) on top of the local shim, so the existing ingest pipeline works
 * unchanged.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createLocalShimClient } from "./supabase/local-shim";

interface LocalBrainPage {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string | null;
  timeline: string | null;
  frontmatter: Record<string, unknown> | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface LocalTimelineEntry {
  id: number;
  page_id: number;
  date: string;
  source: string;
  summary: string;
  detail: string;
  created_at: string;
}

interface LocalBrainLink {
  id: number;
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
  created_at: string;
}

/**
 * Drop-in for `BrainClient` that writes into the local PGlite database.
 * Cast to `BrainClient` at the construction site since the runtime is
 * structural and only the three methods below are exercised by `IngestWriter`.
 */
export class LocalBrainClient {
  private readonly client = createLocalShimClient();

  async putPage(page: {
    slug: string;
    type?: string;
    title: string;
    compiled_truth?: string;
    timeline?: string;
    frontmatter?: Record<string, unknown>;
    content_hash?: string;
  }): Promise<LocalBrainPage> {
    const result = await this.client
      .from<LocalBrainPage>("brain_pages")
      .upsert(
        {
          slug: page.slug,
          type: page.type ?? "concept",
          title: page.title,
          compiled_truth: page.compiled_truth ?? "",
          timeline: page.timeline ?? "",
          frontmatter: page.frontmatter ?? {},
          content_hash: page.content_hash ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slug" },
      );

    if (result.error) {
      throw new Error(`putPage failed: ${result.error.message}`);
    }

    const rows = (result.data ?? []) as LocalBrainPage[];
    if (rows.length === 0) {
      throw new Error("putPage returned no rows");
    }
    return rows[0];
  }

  async addTimelineEntry(entry: {
    page_id: number;
    date: string;
    source: string;
    summary: string;
    detail?: string;
  }): Promise<LocalTimelineEntry> {
    const result = await this.client
      .from<LocalTimelineEntry>("brain_timeline")
      .insert({
        page_id: entry.page_id,
        date: entry.date,
        source: entry.source,
        summary: entry.summary,
        detail: entry.detail ?? "",
      });

    if (result.error) {
      throw new Error(`addTimelineEntry failed: ${result.error.message}`);
    }
    const rows = (result.data ?? []) as LocalTimelineEntry[];
    return rows[0];
  }

  async addLink(link: {
    from_slug: string;
    to_slug: string;
    link_type?: string;
    context?: string;
  }): Promise<LocalBrainLink> {
    const result = await this.client
      .from<LocalBrainLink>("brain_links")
      .upsert(
        {
          from_slug: link.from_slug,
          to_slug: link.to_slug,
          link_type: link.link_type ?? "related",
          context: link.context ?? "",
        },
        { onConflict: "from_slug,to_slug,link_type" },
      );

    if (result.error) {
      throw new Error(`addLink failed: ${result.error.message}`);
    }
    const rows = (result.data ?? []) as LocalBrainLink[];
    return rows[0];
  }
}
