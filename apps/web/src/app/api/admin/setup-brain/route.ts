import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDesktopMode } from "@/lib/supabase/local-shim";

const SCHEMA_SQL = `
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

CREATE TABLE IF NOT EXISTS brain_timeline (
  id SERIAL PRIMARY KEY,
  page_id INTEGER REFERENCES brain_pages(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_links (
  id SERIAL PRIMARY KEY,
  from_slug TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'related',
  context TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_slug, to_slug, link_type)
);

CREATE TABLE IF NOT EXISTS brain_tags (
  slug TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (slug, tag)
);

CREATE OR REPLACE VIEW brain_stats AS
SELECT
  (SELECT COUNT(*) FROM brain_pages) as page_count,
  (SELECT COUNT(*) FROM brain_timeline) as timeline_count,
  (SELECT COUNT(*) FROM brain_links) as link_count,
  (SELECT COUNT(*) FROM brain_tags) as tag_count;
`;

export async function POST() {
  // In desktop mode the local PGlite database is auto-initialized on first
  // use and always has the schema applied — nothing to set up here.
  if (!isDesktopMode()) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY — DDL requires service role access" },
        { status: 500 },
      );
    }
  }

  const supabase = createAdminClient();

  // Verify connection by checking if brain_pages exists
  const { data, error } = await supabase
    .from("brain_pages")
    .select("id")
    .limit(1);

  if (error && error.code === "42P01") {
    // Table doesn't exist — schema needs to be applied via Supabase Dashboard or migration
    return NextResponse.json({
      ok: false,
      message: "Tables do not exist yet. Apply the migration via Supabase Dashboard SQL Editor.",
      sql: SCHEMA_SQL,
    });
  }

  // Tables exist — return stats
  const { data: stats, error: statsError } = await supabase
    .from("brain_stats")
    .select("*")
    .single();

  return NextResponse.json({
    ok: true,
    message: "Brain schema tables exist and are accessible.",
    stats: stats ?? null,
    error: statsError?.message ?? null,
  });
}
