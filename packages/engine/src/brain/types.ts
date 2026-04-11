export type PageType = 'person' | 'company' | 'project' | 'concept' | 'tool' | 'workflow';

export interface BrainPage {
  id: number;
  slug: string;
  type: PageType;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: Record<string, unknown>;
  content_hash?: string;
  created_at: string;
  updated_at: string;
}

export interface TimelineEntry {
  id: number;
  page_id: number;
  date: string;
  source: string;
  summary: string;
  detail: string;
  created_at: string;
}

export interface BrainLink {
  id: number;
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
  created_at: string;
}

export interface BrainStats {
  page_count: number;
  timeline_count: number;
  link_count: number;
  tag_count: number;
}
