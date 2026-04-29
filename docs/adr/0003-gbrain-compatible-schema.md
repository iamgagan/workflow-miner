# 0003 — gbrain-compatible brain schema

- **Date:** 2026-04-29
- **Status:** Accepted

## Context

After Garry Tan open-sourced [gbrain](https://github.com/garrytan/gbrain) in April 2026, we noticed our brain schema was already nearly identical to his — `brain_pages` with `compiled_truth` + `timeline` + `frontmatter` + cross-links via `brain_links`, plus pgvector for embeddings. The original schema header even said `-- gbrain-compatible schema for Supabase Postgres`.

Forces:

- **Distribution:** gbrain has 5,400 GitHub stars in 24 hours. Aligning with it gives us free narrative gravity (YC's Summer 2026 RFS has a "Company Brain" category).
- **User portability:** if a user has a gbrain vault, they should be able to feed Workflow Miner from it. Conversely, if a user wants to leave Workflow Miner, they should be able to take their data and run gbrain on it.
- **Coordination:** Tolaria (a related desktop knowledge tool, AGPL) reads the same vault format. Three projects sharing a format means the format wins.

## Decision

Maintain **format-level compatibility** with gbrain at three layers:

1. **Schema** (`packages/engine/src/brain/schema.sql`) — `brain_pages` columns match gbrain's: `slug`, `type`, `title`, `compiled_truth`, `timeline`, `frontmatter`, `embedding`. Same for `brain_links`, `brain_tags`.
2. **Markdown export** (`apps/web/src/inngest/markdown.ts` + `exportToGit` Inngest function) — emit gbrain-format `.md` files with `pages/<type>/<slug>.md` layout. Each file has YAML frontmatter (title/type/slug/created/updated/links/tags) and `## Compiled truth` + `## Timeline` sections.
3. **Tool naming on the MCP server** (`packages/mcp-server/src/index.ts`) — `search_brain`, `get_page`, `list_recent_activity` match gbrain's MCP tool names. `list_patterns` and `trigger_workflow` are unique to Workflow Miner.

We do NOT match:

- gbrain's exact CLI command surface (we have `pnpm desktop:dev`, not `gbrain run`).
- gbrain's "dream cycle" prompt verbatim — ours is similar in spirit (entity extraction + compiled-truth refresh) but we tune for SaaS-ingest-derived content rather than personal note-taking.

## Consequences

- **Pro:** A user can `git clone` their Workflow Miner Markdown export and run `gbrain` CLI on it — the vault is interchangeable.
- **Pro:** Tolaria opens our exported vault as-is (Tolaria reads markdown + git). We get cross-product interop for free.
- **Pro:** The pitch "we're the company-brain version of gbrain" is technically true at the data layer.
- **Con:** Coupled to gbrain's format evolution. If Garry breaks his schema, we have to follow or fork.
- **Con:** Some Workflow Miner-specific data (pattern frequency scores, source-system metadata) doesn't have a clean place in gbrain's frontmatter — we put it in `frontmatter` JSONB but gbrain CLI ignores it.

## Alternatives considered

- **Roll our own format** — would let us optimize for our specific needs (workflow patterns) but loses all the distribution / interop advantages. Rejected.
- **Markdown-only, no Postgres** — what Tolaria does. Cleaner for personal use, but breaks down for team-scale (concurrent writes, vector search at 10k+ pages). Rejected for the Team tier; partially adopted (Markdown export) for portability.
- **Support gbrain format AS WELL AS our own** — too much surface to maintain. Rejected.
