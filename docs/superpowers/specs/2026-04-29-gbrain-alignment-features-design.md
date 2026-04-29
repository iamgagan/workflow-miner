# gbrain-alignment features: Dream Cycles, MCP server, Markdown export

- **Date:** 2026-04-29
- **Status:** Approved (brainstorming complete) — ready for implementation plan
- **Author:** Brainstormed with the user (Gagan)
- **Related:** [`apps/web/src/inngest/functions.ts`](../../../apps/web/src/inngest/functions.ts), [`packages/engine/src/brain/schema.sql`](../../../packages/engine/src/brain/schema.sql), [YC RFS — Company Brain](https://www.ycombinator.com/rfs), [garrytan/gbrain](https://github.com/garrytan/gbrain)
- **Branch:** `workflow-miner` (current commit `15a3e5c`, single-tenant per Supabase deployment)

## Executive summary

Workflow Miner already implements gbrain's data model (brain_pages with compiled_truth + timeline + frontmatter, brain_links, pgvector with HNSW). To position as the company-version of gbrain — and to take the YC Summer 2026 Company Brain RFS pitch from "compatible schema" to "drop-in compatible at the API + file-system + agent-tooling levels" — we add three features:

1. **Dream Cycles** — nightly Inngest job that enriches brain pages with extracted entities, fresh compiled-truth summaries, and refreshed embeddings (~$0.40/day per 1K pages).
2. **MCP server** — standalone npm package `@workflow-miner/mcp` that exposes the company brain as a Model Context Protocol server, so Claude Code / Cursor users in the company can query it from their editor.
3. **Markdown export to git** — nightly mirror of `brain_pages` to a GitHub repo as gbrain-format `.md` files; lets users layer gbrain CLI on top of the company brain.

Total surface: 15 new files (covering 12 functional units across 3 features), 5 modified, 1 schema column + 1 index + 1 table, ~750 net lines.

## Goals

- Match gbrain's tool surface so users can swap between gbrain (personal) and Workflow Miner (company) on the same data shapes.
- Add automatic knowledge-graph enrichment so the brain gets smarter without user intervention.
- Distribute via Claude Code / Cursor's MCP ecosystem — every Claude Code user inside a customer org becomes a brain user.
- Give customers a real backup/sovereignty story: a copy of their brain in their own GitHub repo, in the format Garry Tan publishes.

## Non-goals

- Two-way sync (markdown edits → Postgres). Read-only mirror in v1; conflict resolution is its own design.
- A hosted/SaaS MCP server. Stdio-based CLI only — zero infra on our side.
- Replacing the brain agent (`/brain`) with MCP. The web UI stays; MCP is for editor-side power users.
- A GitHub App (vs PAT) for the export. PAT in v1; App is v2 polish.
- Self-hosted Inngest. Inngest cloud (or local `inngest-cli dev`) only.
- Migration of existing data. Schema additions are additive (`ALTER TABLE … ADD COLUMN` / `CREATE TABLE IF NOT EXISTS`) — safe on the current empty deployment.

---

## Feature 1 — Dream Cycles

### What it does
A nightly job that walks every brain page touched in the last 24h and uses `gpt-4o-mini` to:
- **Extract entities** mentioned in the page (people / companies / projects) and upsert them as new `brain_pages` rows of the corresponding type.
- **Cross-link**: insert `brain_links` rows from the source page to each extracted entity (`link_type='mentions'`).
- **Refresh compiled_truth**: regenerate the page's 1-paragraph LLM summary from its current timeline entries.
- **Re-embed** if `compiled_truth` changed (skip if unchanged — the embedding is stable).

### Architecture
```
Inngest cron schedule (default "0 3 * * *" UTC, env-overridable)
   ↓
dreamCycle({ event, step })
   ├─ step.run("find-stale-pages")
   │     SELECT id, slug, type, compiled_truth, updated_at
   │     FROM brain_pages
   │     WHERE last_enriched_at IS NULL OR last_enriched_at < updated_at
   │     ORDER BY last_enriched_at NULLS FIRST, updated_at DESC
   │     LIMIT $DREAM_CYCLE_MAX_PAGES_PER_RUN  (default 500)
   │
   ├─ for each page (sequential, each wrapped in step.run for retry isolation):
   │     ├─ extract-entities → gpt-4o-mini, returns [{type, name, slug}]
   │     ├─ upsert entity pages + brain_links rows
   │     ├─ refresh-compiled-truth → gpt-4o-mini, summarizes timeline
   │     ├─ re-embed if compiled_truth changed
   │     └─ UPDATE brain_pages SET last_enriched_at = NOW() WHERE id = ?
   │
   └─ step.sendEvent("dream-cycle-completed")  → triggers exportToGit (Feature 3)
```

### Schema delta
```sql
ALTER TABLE brain_pages
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS brain_pages_last_enriched_idx
  ON brain_pages (last_enriched_at NULLS FIRST);
```

### Inngest function
- File: `apps/web/src/inngest/functions.ts` — new export `dreamCycle`.
- Trigger: `{ cron: process.env.DREAM_CYCLE_CRON ?? "0 3 * * *" }` AND `{ event: "dream/cycle.requested" }` (manual).
- Registered in `apps/web/src/app/api/inngest/route.ts`.

### Manual trigger route
- `POST /api/dream/run` — auth-required; sends `dream/cycle.requested` event to Inngest. Returns `{ ok: true, eventId }`.

### Cost envelope
With `gpt-4o-mini` ($0.15/1M in, $0.60/1M out), one page enrichment ≈ 2 LLM calls (entities + summary) + 1 embed call ≈ **$0.0004**. A 1,000-page brain enriching nightly: **~$0.40/day** = ~$12/mo. A 10K-page brain: ~$120/mo. The `DREAM_CYCLE_MAX_PAGES_PER_RUN` cap (default 500) keeps spend bounded; pages roll over to subsequent nights.

### Decisions made during brainstorming
- **Schedule:** default `0 3 * * *` UTC, exposed as `DREAM_CYCLE_CRON` env var. Each company can shift to their off-hours.
- **Manual trigger:** yes, via `POST /api/dream/run`.
- **Model:** `gpt-4o-mini` (env: `OPENAI_MODEL_ENRICH`). Entity extraction is well within capability.
- **Page selection:** stale = `last_enriched_at IS NULL OR last_enriched_at < updated_at`. Pages updated by the user (or by sync) get re-enriched; otherwise skipped.

### Risks / safeguards
- **Self-touch loop:** if `last_enriched_at` updates `updated_at` (it shouldn't — separate column — but worth being defensive), the page would re-enrich every cycle. Verify the column update doesn't bump `updated_at`.
- **Cost runaway:** beyond `DREAM_CYCLE_MAX_PAGES_PER_RUN`, add an `enrichment_version` counter (or use `frontmatter.enrichment_version`) and skip pages where the counter exceeds 10. Prevents pathological loops.
- **Concurrency:** Inngest's `step.run` is serialized per function run; safe.

---

## Feature 2 — MCP Server

### What it does
A standalone npm package `@workflow-miner/mcp` that runs as a stdio MCP server. A user installs it in their Claude Code / Cursor config; the server proxies tool calls (over HTTPS, with an API key) to the company's Workflow Miner deployment. Result: every Claude Code user inside a customer org can ask their editor "what does our brain know about X?" without opening a browser.

### Architecture
```
Claude Code / Cursor / any MCP client
       │
       │ stdio (JSON-RPC)
       ▼
@workflow-miner/mcp  (Node CLI, ~150 LOC)
       │
       │ HTTPS, "Authorization: Bearer wmk_<random>"
       ▼
WM deployment, /api/mcp/{tool}
       │
       │ mcp-auth middleware: SHA-256 → api_keys lookup → set last_used_at
       │
       ▼
Postgres (brain_pages, brain_timeline, brain_links) + RPCs (match_*)
```

### Tools exposed
| MCP tool | What it does | Backend |
|---|---|---|
| `search_brain(query)` | Vector search over pages + timeline | `match_brain_pages` + `match_timeline_entries` |
| `get_page(slug)` | Fetch a single brain page | `SELECT FROM brain_pages WHERE slug = ?` |
| `list_recent_activity(source?)` | Recent timeline entries | `SELECT FROM brain_timeline ORDER BY date DESC LIMIT 50` |
| `list_patterns(limit?)` | Detected workflow patterns | `SELECT FROM brain_pages WHERE type='pattern'` |
| `trigger_workflow(workflowId, parameters)` | Execute a pattern | Sends `pattern/execute.requested` to Inngest |

`search_brain` and `get_page` use the same names gbrain's MCP uses, for drop-in compatibility. `trigger_workflow` is unique to Workflow Miner.

### Schema delta
```sql
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
```

### New API routes (Next.js, in `apps/web/src/app/api/`)
- `POST /api/keys` (auth'd) — generates `wmk_<32-byte base64url>`; stores SHA-256 hash; returns the raw key once (one-time reveal pattern).
- `GET /api/keys` (auth'd) — returns the user's non-revoked keys with `label`, `created_at`, `last_used_at`.
- `DELETE /api/keys/[id]` (auth'd) — sets `revoked_at = NOW()`.
- `POST /api/mcp/search` — body `{ query: string }`; gated by mcp-auth middleware.
- `GET /api/mcp/page/[slug]` — gated by mcp-auth middleware.
- `GET /api/mcp/activity?source=...` — gated by mcp-auth middleware.
- `GET /api/mcp/patterns?limit=...` — gated by mcp-auth middleware.
- `POST /api/mcp/trigger` — body `{ workflowId, parameters }`; gated; sends Inngest event.

### Shared mcp-auth middleware
- File: `apps/web/src/lib/mcp-auth.ts`
- Parses `Authorization: Bearer wmk_*`, computes SHA-256, looks up `api_keys`, checks `revoked_at IS NULL`, sets `last_used_at = NOW()` (fire-and-forget), returns `{ userId }` or 401.

### MCP server package
- New workspace package at `packages/mcp-server/`.
- `package.json` — name `@workflow-miner/mcp`, bin `wm-mcp` → `bin/wm-mcp.js`.
- `src/index.ts` — uses `@modelcontextprotocol/sdk` to create a server, registers the 5 tools, each tool's `execute` is `fetch(${WM_URL}/api/mcp/${tool}, { headers: { Authorization: "Bearer ${WM_API_KEY}" } })`.
- Reads `WM_URL` and `WM_API_KEY` from env (set via the user's MCP client config).

### UI page
- `apps/web/src/app/(dashboard)/settings/api-keys/page.tsx` — list keys, create (with one-time reveal modal), revoke. Uses existing shadcn `Card` / `Button` / `Dialog`.

### User install path
```jsonc
// User pastes into ~/.claude/settings.json (or Cursor config)
{
  "mcpServers": {
    "company-brain": {
      "command": "npx",
      "args": ["-y", "@workflow-miner/mcp"],
      "env": {
        "WM_URL": "https://brain.acme.com",
        "WM_API_KEY": "wmk_<the one-time-revealed key>"
      }
    }
  }
}
```

### Decisions made during brainstorming
- **Transport:** stdio CLI (not SSE/HTTP MCP server). Stable, zero infra on our side, matches Claude Code's standard MCP pattern.
- **Tool naming:** `search_brain` and `get_page` match gbrain's exact names for drop-in compatibility. `trigger_workflow` is ours.
- **API key scope:** per-user (the key carries the user's auth.uid via `api_keys.user_id`). Auditable, revokable, matches industry standard.
- **API key format:** `wmk_<base64url(32 random bytes)>`. SHA-256 hash stored, raw key shown once.

### Risks / safeguards
- **MCP SDK churn:** `@modelcontextprotocol/sdk` is young; pin a known-good version (e.g. `^0.6.x`) and follow upstream for breaking changes.
- **Rate limiting:** v1 has none. Add per-key rate limits in v2 if abuse appears.
- **Key leakage in logs:** never log the raw `wmk_*` key or the `Authorization` header. Verify in code review.
- **Last-used timestamp churn:** updating `last_used_at` on every request adds write load. Use a fire-and-forget pattern; if it gets noisy, batch via Redis or a periodic flush.

---

## Feature 3 — Markdown Export to GitHub

### What it does
A scheduled (and on-demand) Inngest job that snapshots `brain_pages` + `brain_links` to gbrain-format `.md` files and commits them to a GitHub repo the user owns. Read-only mirror in v1: Postgres is source of truth; the git repo is a published copy. Result: customers get a backup, a browsable text version, and gbrain CLI compatibility on the same vault.

### Architecture
```
Trigger: dream/cycle.completed event (chained from dreamCycle)
       OR: POST /api/export/run (manual)
       OR: cron, if user prefers decoupled scheduling (DREAM_CYCLE_CRON drives both today)
   ↓
exportToGit({ event, step })
   ├─ step.run("snapshot-pages")
   │     SELECT id, slug, type, title, compiled_truth, timeline, frontmatter,
   │            updated_at, COALESCE(frontmatter->>'last_exported_at', '1970-01-01') AS last_exported
   │     FROM brain_pages
   │     WHERE updated_at > last_exported::timestamptz
   │
   ├─ step.run("snapshot-links")
   │     SELECT * FROM brain_links
   │
   ├─ step.run("fetch-current-tree")
   │     octokit.git.getTree({ owner, repo, tree_sha: "main", recursive: true })
   │
   ├─ step.run("write-blobs")
   │     for each page → octokit.git.createBlob({ content: <markdown>, encoding: "utf-8" })
   │
   ├─ step.run("create-tree")
   │     octokit.git.createTree({ base_tree, tree: [{path, mode, type, sha}, ...] })
   │
   ├─ step.run("commit-and-update-ref")
   │     octokit.git.createCommit + octokit.git.updateRef("heads/main")
   │
   └─ step.run("mark-exported")
         UPDATE brain_pages SET frontmatter = frontmatter || jsonb_build_object('last_exported_at', NOW())
         WHERE id IN (...exported)
```

We use **Octokit's tree/blob/commit API** rather than `simple-git`. Vercel serverless has no persistent FS, so cloning a real git repo isn't workable. Octokit lets us atomically construct a commit via API calls.

### File shape (gbrain-compatible)
```markdown
---
title: ACME Q3 Roadmap
type: concept
slug: acme-q3-roadmap
created: 2026-04-15T00:00:00Z
updated: 2026-04-29T00:00:00Z
links:
  - to: garry-tan
    type: mentions
  - to: pattern-onboarding-flow
    type: derived-from
tags: [roadmap, eng]
---

## Compiled truth

The team agreed to migrate the database to Supabase and use pgvector for AI…

## Timeline

- 2026-04-29 (slack) — Garry confirmed budget approved
- 2026-04-22 (linear) — Ticket WF-142 created for migration
```

### File layout in the repo
```
<repo-root>/
  pages/
    concept/
      acme-q3-roadmap.md
      employee-onboarding.md
    person/
      garry-tan.md
    company/
      acme-corp.md
    pattern/
      pattern-onboarding-flow.md
```

`<type>/<slug>.md` matches gbrain CLI's expected layout.

### Schema delta
**None.** `last_exported_at` lives inside the existing `frontmatter JSONB` column on `brain_pages`. It's an export-tracking artifact, not domain data, so it doesn't earn its own column.

### Inngest function
- File: `apps/web/src/inngest/functions.ts` — new export `exportToGit`.
- Triggers: `{ event: "dream/cycle.completed" }` AND `{ event: "export/run.requested" }`.
- Skips itself if `GITHUB_EXPORT_PAT` or `GITHUB_EXPORT_REPO` are unset (allows users to enable Dream Cycles without enabling Markdown export).
- Registered in `apps/web/src/app/api/inngest/route.ts`.

### Manual trigger route
- `POST /api/export/run` — auth-required; sends `export/run.requested` event. Returns `{ ok: true, eventId }`.

### New env vars
```env
# Markdown export to GitHub (optional — leave blank to disable)
GITHUB_EXPORT_PAT=        # fine-scoped PAT with `repo` write
GITHUB_EXPORT_REPO=       # owner/repo, e.g. acme/company-brain-mirror
GITHUB_EXPORT_BRANCH=main # defaults to main
```

### New deps (apps/web)
- `@octokit/rest` (GitHub API client)
- (No `simple-git` — Octokit-only.)

### Decisions made during brainstorming
- **Target:** GitHub repo via Octokit. Works from Vercel serverless; gives users free version history + backup story for free.
- **Auth:** PAT for v1. GitHub App is a v2 polish.
- **Direction:** read-only mirror, Postgres → Markdown only. Two-way sync deferred (conflict resolution is its own design).
- **Trigger:** auto-runs at the end of each Dream Cycle (mirror is always one cycle behind brain) + manual button via `/api/export/run`.

### Risks / safeguards
- **Large diffs:** if a customer never exports for a while, the first run could write thousands of files. Octokit handles this fine but expect a multi-second commit. Acceptable.
- **PAT leakage:** the PAT lives in the Vercel project's env vars. Standard practice; document not to commit it.
- **Repo doesn't exist / wrong scopes:** detect the 401/404 from Octokit and write a clear error to Inngest logs. Don't crash — disable for that user, surface in `/settings`.
- **Branch protection / required reviews:** if the user has them on `main`, the commit will fail. Document: use a non-protected branch, or set `GITHUB_EXPORT_BRANCH` to a different branch.

---

## Cross-cutting summary

### Schema additions (one migration to `packages/engine/src/brain/schema.sql`)
```sql
-- For Dream Cycles
ALTER TABLE brain_pages
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS brain_pages_last_enriched_idx
  ON brain_pages (last_enriched_at NULLS FIRST);

-- For MCP server
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
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
```

### Env additions (`.env.example`)
```env
# Dream Cycles
DREAM_CYCLE_CRON=0 3 * * *
DREAM_CYCLE_MAX_PAGES_PER_RUN=500
OPENAI_MODEL_ENRICH=gpt-4o-mini

# Markdown export (optional)
GITHUB_EXPORT_PAT=
GITHUB_EXPORT_REPO=
GITHUB_EXPORT_BRANCH=main
```

### Dependency additions
- `apps/web/package.json`: `@octokit/rest`
- `packages/mcp-server/package.json` (new): `@modelcontextprotocol/sdk`

### Files added (15 paths, 12 functional units)
**Trigger routes (2):**
- `apps/web/src/app/api/dream/run/route.ts`
- `apps/web/src/app/api/export/run/route.ts`

**API key management (3):**
- `apps/web/src/app/api/keys/route.ts` (POST create + GET list)
- `apps/web/src/app/api/keys/[id]/route.ts` (DELETE revoke)
- `apps/web/src/app/(dashboard)/settings/api-keys/page.tsx`

**MCP HTTP API (5):**
- `apps/web/src/app/api/mcp/search/route.ts`
- `apps/web/src/app/api/mcp/page/[slug]/route.ts`
- `apps/web/src/app/api/mcp/activity/route.ts`
- `apps/web/src/app/api/mcp/patterns/route.ts`
- `apps/web/src/app/api/mcp/trigger/route.ts`

**Shared lib (1):**
- `apps/web/src/lib/mcp-auth.ts`

**MCP CLI package (4 files = 1 unit):**
- `packages/mcp-server/package.json`
- `packages/mcp-server/src/index.ts`
- `packages/mcp-server/bin/wm-mcp.js`
- `packages/mcp-server/README.md`

### Files modified (5)
- `apps/web/src/inngest/functions.ts` — adds `dreamCycle` + `exportToGit`
- `apps/web/src/app/api/inngest/route.ts` — registers both
- `apps/web/package.json` — adds `@octokit/rest`
- `packages/engine/src/brain/schema.sql` — schema additions above
- `.env.example` — env additions above

### Total scope
~750 net lines of code. Sized for ~1–2 days of focused implementation.

---

## Risks & open questions

1. **Inngest cron + Vercel reachability.** Inngest cloud needs to reach `/api/inngest`. Confirmed pattern; just needs prod URL configured in Inngest dashboard.

2. **Cost runaway from self-touch loops.** `last_enriched_at` is on a separate column from `updated_at` — so updating one shouldn't bump the other. Verify with a Postgres trigger inspection or test, and add an `enrichment_version` int counter capped at 10 as a belt-and-suspenders safeguard.

3. **MCP SDK API churn.** `@modelcontextprotocol/sdk` versioning is young. Pin to a known-good minor and follow upstream releases.

4. **Octokit rate limits.** GitHub allows 5K req/hour authenticated. A nightly export with ~1K pages = ~3K API calls (tree + blobs + commit). Comfortable margin; revisit at 10K-page scale.

5. **GitHub branch protection.** If the user has required-reviews on the export branch, the commit fails silently. Document the workaround (use a separate branch); v2 could open a PR instead of pushing.

6. **What does "company brain" deduplication look like?** Two pages about the same person with slightly different slugs (`garry-tan` vs `garry`) is a real risk during entity extraction. v1: dumb slug-equality. v2: fuzzy matching + LLM-driven dedupe.

7. **Should `dream/cycle.completed` always trigger export?** Right now yes (chained). If a user wants Dream Cycles without Markdown export, they leave `GITHUB_EXPORT_*` unset and `exportToGit` no-ops. Acceptable.

## Implementation order (proposed for the writing-plans phase)

1. **Schema additions** — apply to a fresh Supabase project, verify RLS and trigger semantics.
2. **Dream Cycles** — most isolated, lowest blast radius. Write the function, register it, test with the manual route.
3. **Markdown export** — depends on Dream Cycles in the chained-trigger sense, but works independently. Octokit integration. Manual route first, then the chained event.
4. **MCP server** — biggest surface (10+ files). API keys schema + routes + middleware first. Then `/api/mcp/*` routes. Then the standalone npm package. Then publish to npm with a placeholder version.
5. **Settings UI for API keys** — last, since the API works without it (curl the routes).

## Out of scope (explicitly deferred)

- Two-way sync (markdown edits → Postgres). Conflict resolution is its own design.
- Per-key rate limiting. Add when abuse appears.
- A GitHub App (vs PAT). PAT is fine for v1.
- Hosted MCP server (vs stdio CLI). Stdio is the standard; SSE is newer and unnecessary.
- Migration script for existing data. Not needed — current deployment has no production data on the new schema.
- Org switcher / team management UI. Single-tenant per-deployment means every authenticated user sees the same brain by design.
- Real `executePattern` runtime adapters (n8n / Zapier / Claude skill pack execution). The brain agent's `triggerWorkflow` already dispatches; the runtime adapter is a separate, larger effort.

## Next step

After user reviews and approves this spec: invoke the `superpowers:writing-plans` skill to produce an executable implementation plan from this design.
