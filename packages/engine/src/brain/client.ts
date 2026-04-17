import type {
  BrainPage,
  BrainLink,
  BrainStats,
  TimelineEntry,
  PageType,
} from './types.js';

/**
 * Structural shape for a brain storage client.
 *
 * Desktop-only mode: the engine no longer ships a hosted Supabase
 * implementation. Consumers inject a concrete client (e.g. the local
 * PGlite-backed `LocalBrainClient` in `apps/web`) that implements this
 * interface; `IngestWriter` depends only on this shape.
 */
export interface BrainClient {
  putPage(page: {
    slug: string;
    type?: PageType;
    title: string;
    compiled_truth?: string;
    timeline?: string;
    frontmatter?: Record<string, unknown>;
    content_hash?: string;
  }): Promise<BrainPage>;

  getPage(slug: string): Promise<BrainPage | null>;

  listPages(options?: {
    type?: PageType;
    limit?: number;
    offset?: number;
  }): Promise<BrainPage[]>;

  search(query: string, options?: { limit?: number }): Promise<BrainPage[]>;

  getStats(): Promise<BrainStats>;

  addTimelineEntry(entry: {
    page_id: number;
    date: string;
    source: string;
    summary: string;
    detail?: string;
  }): Promise<TimelineEntry>;

  getTimeline(
    pageId: number,
    options?: { limit?: number; offset?: number },
  ): Promise<TimelineEntry[]>;

  addLink(link: {
    from_slug: string;
    to_slug: string;
    link_type?: string;
    context?: string;
  }): Promise<BrainLink>;
}
