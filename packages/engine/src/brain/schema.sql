-- gbrain-compatible schema for Supabase Postgres.
--
-- Deployment model: ONE company = ONE Supabase project.
-- Multi-tenancy is achieved by isolation of deployments, not by row-level
-- tenant filtering. Every authenticated user of this Supabase project is
-- assumed to be a member of the same company and shares the same brain.
--
-- For the multi-tenant SaaS variant (one Supabase project shared by many
-- companies), see commit 94a2eac and the v1 PIVOT-COMPANY-BRAIN.md notes.
CREATE EXTENSION IF NOT EXISTS vector;

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
  embedding vector(1536),
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
  embedding vector(1536),
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

-- Row Level Security: any authenticated user of this Supabase project
-- (i.e. any employee of the company that owns this deployment) can read
-- and write the brain. The `anon` role is locked out by omission — only
-- `authenticated` is granted access. The service-role key (used by the
-- engine's background jobs) bypasses RLS by design.
ALTER TABLE brain_pages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_tags     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access" ON brain_pages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access" ON brain_timeline
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access" ON brain_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access" ON brain_tags
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Stats view (no RLS needed — the underlying tables enforce it).
CREATE OR REPLACE VIEW brain_stats AS
SELECT
  (SELECT COUNT(*) FROM brain_pages)    as page_count,
  (SELECT COUNT(*) FROM brain_timeline) as timeline_count,
  (SELECT COUNT(*) FROM brain_links)    as link_count,
  (SELECT COUNT(*) FROM brain_tags)     as tag_count;

-- Indexes: brain_pages.slug already has the UNIQUE constraint covering
-- exact lookup. The other tables get an index on the most-queried column.
CREATE INDEX IF NOT EXISTS brain_timeline_date_idx ON brain_timeline (date DESC);
CREATE INDEX IF NOT EXISTS brain_links_from_idx   ON brain_links    (from_slug);
CREATE INDEX IF NOT EXISTS brain_links_to_idx     ON brain_links    (to_slug);

-- HNSW indexes for ANN cosine similarity. Requires pgvector >= 0.5.0
-- (Supabase ships 0.7+).
CREATE INDEX IF NOT EXISTS brain_pages_embedding_hnsw
  ON brain_pages USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS brain_timeline_embedding_hnsw
  ON brain_timeline USING hnsw (embedding vector_cosine_ops);

-- RPC: vector similarity search over the timeline.
-- Called by /api/brain/agent's searchCompanyKnowledge tool.
CREATE OR REPLACE FUNCTION match_timeline_entries(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id int,
  page_id int,
  date timestamptz,
  source text,
  summary text,
  detail text,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    bt.id,
    bt.page_id,
    bt.date,
    bt.source,
    bt.summary,
    bt.detail,
    1 - (bt.embedding <=> query_embedding) AS similarity
  FROM brain_timeline bt
  WHERE bt.embedding IS NOT NULL
    AND 1 - (bt.embedding <=> query_embedding) > match_threshold
  ORDER BY bt.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- RPC: vector similarity search over pages (compiled truths).
CREATE OR REPLACE FUNCTION match_brain_pages(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id int,
  slug text,
  title text,
  type text,
  compiled_truth text,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    bp.id,
    bp.slug,
    bp.title,
    bp.type,
    bp.compiled_truth,
    1 - (bp.embedding <=> query_embedding) AS similarity
  FROM brain_pages bp
  WHERE bp.embedding IS NOT NULL
    AND 1 - (bp.embedding <=> query_embedding) > match_threshold
  ORDER BY bp.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- ─── gbrain-alignment additions (2026-04-29) ──────────────────────────────

-- Dream Cycles: track when each page was last LLM-enriched.
ALTER TABLE brain_pages
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

-- Index helps the "find stale pages" query in the dream cycle find work fast.
CREATE INDEX IF NOT EXISTS brain_pages_last_enriched_idx
  ON brain_pages (last_enriched_at NULLS FIRST);

-- MCP server: per-user API keys.
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,        -- SHA-256 of the raw key; raw never persisted
  label TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see their own keys" ON api_keys
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id);
