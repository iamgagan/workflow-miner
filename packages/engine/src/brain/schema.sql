-- gbrain-compatible schema for Supabase Postgres
CREATE EXTENSION IF NOT EXISTS vector;

-- Pages (entities: workflows, people, tools, patterns)
CREATE TABLE IF NOT EXISTS brain_pages (
  id SERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'concept',
  title TEXT NOT NULL,
  compiled_truth TEXT DEFAULT '',
  timeline TEXT DEFAULT '',
  frontmatter JSONB DEFAULT '{}',
  content_hash TEXT,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, slug)
);

-- Timeline entries (append-only event log)
CREATE TABLE IF NOT EXISTS brain_timeline (
  id SERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL,
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
  organization_id TEXT NOT NULL,
  from_slug TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'related',
  context TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, from_slug, to_slug, link_type)
);

-- Tags
CREATE TABLE IF NOT EXISTS brain_tags (
  organization_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (organization_id, slug, tag)
);

-- Row Level Security (RLS)
ALTER TABLE brain_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_tags ENABLE ROW LEVEL SECURITY;

-- Basic RLS Policies (assuming users belong to an organization and their org_id is available in auth.jwt)
CREATE POLICY "Users can access their organization's pages" ON brain_pages
  USING (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

CREATE POLICY "Users can access their organization's timeline" ON brain_timeline
  USING (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

CREATE POLICY "Users can access their organization's links" ON brain_links
  USING (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

CREATE POLICY "Users can access their organization's tags" ON brain_tags
  USING (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

-- Stats view — security_invoker means the view executes with the caller's
-- permissions, so RLS on the underlying tables filters counts to the caller's
-- organization (instead of leaking global counts across tenants).
CREATE OR REPLACE VIEW brain_stats WITH (security_invoker = true) AS
SELECT
  (SELECT COUNT(*) FROM brain_pages)    as page_count,
  (SELECT COUNT(*) FROM brain_timeline) as timeline_count,
  (SELECT COUNT(*) FROM brain_links)    as link_count,
  (SELECT COUNT(*) FROM brain_tags)     as tag_count;

-- Indexes for multi-tenant query performance.
CREATE INDEX IF NOT EXISTS brain_pages_org_idx    ON brain_pages    (organization_id);
CREATE INDEX IF NOT EXISTS brain_timeline_org_idx ON brain_timeline (organization_id, date DESC);
CREATE INDEX IF NOT EXISTS brain_links_org_idx    ON brain_links    (organization_id);
CREATE INDEX IF NOT EXISTS brain_tags_org_idx     ON brain_tags     (organization_id);

-- HNSW indexes for ANN cosine similarity on the embedding columns.
-- Requires pgvector >= 0.5.0 (Supabase ships 0.7+).
CREATE INDEX IF NOT EXISTS brain_pages_embedding_hnsw
  ON brain_pages USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS brain_timeline_embedding_hnsw
  ON brain_timeline USING hnsw (embedding vector_cosine_ops);

-- RPC: vector similarity search over an organization's timeline entries.
-- Called by /api/brain/agent's searchCompanyKnowledge tool.
CREATE OR REPLACE FUNCTION match_timeline_entries(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  org_id text
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
  WHERE bt.organization_id = org_id
    AND bt.embedding IS NOT NULL
    AND 1 - (bt.embedding <=> query_embedding) > match_threshold
  ORDER BY bt.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- RPC: vector similarity search over an organization's pages (compiled truths).
CREATE OR REPLACE FUNCTION match_brain_pages(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  org_id text
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
  WHERE bp.organization_id = org_id
    AND bp.embedding IS NOT NULL
    AND 1 - (bp.embedding <=> query_embedding) > match_threshold
  ORDER BY bp.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- ─── Org provisioning trigger ──────────────────────────────────────────────
-- Auto-assign each new auth user a personal organization_id (a fresh UUID)
-- so RLS policies see a non-null claim immediately on first login.
--
-- App code does `user.app_metadata.organization_id || user.id` as a fallback
-- on writes, but RLS reads `auth.jwt() -> 'app_metadata' ->> 'organization_id'`
-- directly and would block every query without this hook.
--
-- For team-org semantics (invite-based, multi-user orgs), replace this with
-- an invite-redemption flow that sets app_metadata at /api/orgs/accept-invite.
CREATE OR REPLACE FUNCTION public.provision_user_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  existing_org text;
BEGIN
  existing_org := NEW.raw_app_meta_data ->> 'organization_id';
  IF existing_org IS NULL OR existing_org = '' THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                         || jsonb_build_object('organization_id', gen_random_uuid()::text)
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.provision_user_organization();

-- ─── Multi-user organizations ──────────────────────────────────────────────
-- Each auth user starts in a personal org (the trigger above). To work as
-- a team, a user can issue an invite for another email; the invitee accepts
-- via /api/orgs/accept which calls accept_org_invite() to atomically:
--   1. validate the token + expiry
--   2. add the invitee to org_members
--   3. switch the invitee's app_metadata.organization_id to the inviting org

CREATE TABLE IF NOT EXISTS org_members (
  organization_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_members_user_idx ON org_members (user_id);

CREATE TABLE IF NOT EXISTS org_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS org_invites_org_idx   ON org_invites (organization_id);
CREATE INDEX IF NOT EXISTS org_invites_token_idx ON org_invites (token);
CREATE INDEX IF NOT EXISTS org_invites_email_idx ON org_invites (lower(email));

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read their org's membership" ON org_members
  FOR SELECT USING (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

CREATE POLICY "Members can read their org's invites" ON org_invites
  FOR SELECT USING (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

-- accept_org_invite — runs as SECURITY DEFINER so it can update auth.users
-- regardless of the caller's RLS posture. Returns the new organization_id
-- so the client can refresh the session.
CREATE OR REPLACE FUNCTION public.accept_org_invite(invite_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  invite_row org_invites%ROWTYPE;
  acting_user UUID;
  acting_email TEXT;
BEGIN
  acting_user := auth.uid();
  IF acting_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT email INTO acting_email FROM auth.users WHERE id = acting_user;

  SELECT * INTO invite_row
  FROM org_invites
  WHERE token = invite_token
    AND accepted_at IS NULL
    AND expires_at > NOW()
    AND lower(email) = lower(acting_email);

  IF invite_row.id IS NULL THEN
    RAISE EXCEPTION 'invite is invalid, expired, or addressed to a different email';
  END IF;

  INSERT INTO org_members (organization_id, user_id, role)
  VALUES (invite_row.organization_id, acting_user, invite_row.role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE org_invites SET accepted_at = NOW() WHERE id = invite_row.id;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                       || jsonb_build_object('organization_id', invite_row.organization_id)
  WHERE id = acting_user;

  RETURN invite_row.organization_id;
END;
$$;

-- Make sure the personal org trigger also seeds org_members so we always
-- have a row joining the user to their org.
CREATE OR REPLACE FUNCTION public.provision_user_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  existing_org TEXT;
  new_org TEXT;
BEGIN
  existing_org := NEW.raw_app_meta_data ->> 'organization_id';
  IF existing_org IS NULL OR existing_org = '' THEN
    new_org := gen_random_uuid()::text;
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                         || jsonb_build_object('organization_id', new_org)
    WHERE id = NEW.id;
  ELSE
    new_org := existing_org;
  END IF;

  INSERT INTO org_members (organization_id, user_id, role)
  VALUES (new_org, NEW.id, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
