-- gbrain-compatible schema for Supabase Postgres
-- Pages (entities: workflows, people, tools, patterns)
CREATE TABLE IF NOT EXISTS brain_pages (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'concept',
  title TEXT NOT NULL,
  compiled_truth TEXT DEFAULT '',
  timeline TEXT DEFAULT '',
  frontmatter JSONB DEFAULT '{}',
  content_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Timeline entries (append-only event log)
CREATE TABLE IF NOT EXISTS brain_timeline (
  id SERIAL PRIMARY KEY,
  page_id INTEGER REFERENCES brain_pages(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Links (typed relationships between pages)
CREATE TABLE IF NOT EXISTS brain_links (
  id SERIAL PRIMARY KEY,
  from_slug TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'related',
  context TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_slug, to_slug, link_type)
);

-- Tags
CREATE TABLE IF NOT EXISTS brain_tags (
  slug TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (slug, tag)
);

-- Stats view
CREATE OR REPLACE VIEW brain_stats AS
SELECT
  (SELECT COUNT(*) FROM brain_pages) as page_count,
  (SELECT COUNT(*) FROM brain_timeline) as timeline_count,
  (SELECT COUNT(*) FROM brain_links) as link_count,
  (SELECT COUNT(*) FROM brain_tags) as tag_count;
