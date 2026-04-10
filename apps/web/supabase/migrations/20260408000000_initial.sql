-- Initial schema for workflow-miner (Postgres/Supabase)
-- Mirrors the SQLite schema from packages/engine/src/db/migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_object_type TEXT NOT NULL,
  source_object_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  workspace_id TEXT,
  conversation_id TEXT,
  entity_refs JSONB DEFAULT '[]',
  event_type TEXT NOT NULL,
  content_text TEXT,
  metadata JSONB DEFAULT '{}',
  parent_event_id TEXT,
  causal_links JSONB DEFAULT '[]',
  confidence DOUBLE PRECISION DEFAULT 1.0,
  pii_redaction_state TEXT DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_system, source_object_type);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id);
CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_parent ON events(parent_event_id);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  source_systems JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(start_time, end_time);

CREATE TABLE IF NOT EXISTS patterns (
  pattern_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  frequency INTEGER NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  avg_duration_ms DOUBLE PRECISION,
  source_systems JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patterns_frequency ON patterns(frequency DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC);

CREATE TABLE IF NOT EXISTS pattern_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pattern_id TEXT NOT NULL REFERENCES patterns(pattern_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  position INTEGER NOT NULL,
  source_system TEXT,
  metadata JSONB DEFAULT '{}',
  UNIQUE(pattern_id, position)
);

CREATE INDEX IF NOT EXISTS idx_pattern_events_pattern ON pattern_events(pattern_id);

CREATE TABLE IF NOT EXISTS entities (
  entity_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  source_ids JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);

CREATE TABLE IF NOT EXISTS skills_exported (
  export_id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL REFERENCES patterns(pattern_id),
  skill_name TEXT NOT NULL,
  skill_content TEXT NOT NULL,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_skills_pattern ON skills_exported(pattern_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
