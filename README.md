# Workflow Miner

> **A brain that knows how your company actually works — without giving Amazon, Microsoft, or anyone else a copy.** Plug in Gmail, Slack, Linear, Calendar, GitHub, Notion, Jira, Outlook → get a searchable, queryable, agent-callable brain. Two tiers, same codebase, you pick the one that matches your trust threshold.

## Two tiers

|  | **Personal** (Mac app) | **Team** (cloud, self-hosted) |
|---|---|---|
| **Who** | One person, your laptop | A whole company |
| **Where data lives** | PGlite file in `~/Library/Application Support/WorkflowMiner/brain` on your Mac | Your own Supabase project, in your own cloud account |
| **Network** | LLM features call our cloud proxy (chat/embeddings/classification); the brain itself stays on disk | Standard cloud — Supabase + Vercel + OpenRouter + Inngest, all in your accounts |
| **Trust ask** | The brain stays local. LLM calls go through our proxy with a per-install token; the proxy never sees your raw API keys, just the prompts you send. | Trust your own self-hosted Supabase + Vercel |
| **Auth** | Anonymous device token in Keychain. Connectors use macOS Keychain for OAuth. | Supabase Auth with magic link / Google, gated by allowed-email-domains |
| **Multi-user** | No (one Mac = one brain) | Yes (every authenticated user in the Supabase project shares the brain) |
| **Distribution** | Signed + notarized `.app` (universal binary) | One Vercel + Supabase deploy per company |
| **Status** | **v0.1.0-alpha.4** shipped 2026-05-01 | Production-ready as of `main` |
| **AI cost** | **Free 100k tokens/month per install** (shared OpenRouter pool, BYOK optional) | Whatever your OpenRouter / OpenAI plan costs |

> **Why both?** A brain that observes one person's workflow can absolutely live on that person's machine — that's the Personal tier, and the disk-resident brain can honestly say "your data never leaves your Mac." LLM features (pattern naming, /brain chat, dream cycles) run through a thin cloud proxy to a free shared quota, so alpha users don't have to set up an LLM provider just to try the product. A brain shared across a team needs a central store; the Team tier puts that store in *your company's* infrastructure, not ours.

## What it does (both tiers)

- **Ingest:** OAuth-connect Gmail, Calendar, Slack, Linear, GitHub, Notion, Jira, Outlook → events get normalized + written to your brain.
- **Patterns:** PrefixSpan mining over the timeline finds recurring sequences. An LLM classifier turns raw connector summaries into specific event types (`bug_reported`, `meeting_scheduled`, `code_reviewed`) so the patterns surface real workflows, not generic source-shaped runs.
- **Brain chat:** ask the `/brain` agent in natural language ("what did the team decide about Postgres last week?") — it does agentic RAG over your timeline + page truths and answers with sources.
- **Dream Cycles:** scheduled LLM enrichment refreshes compiled summaries on touched pages, extracts entities (people, companies, projects), and re-embeds. The /brain chat gets sharper after each cycle.
- **Markdown export:** snapshot the brain to disk as gbrain-format `.md` files (desktop: `~/Documents/Workflow Miner/export/`; cloud: configured GitHub repo).
- **Automation:** detected workflow patterns (e.g. "support email → Linear ticket → draft reply") compile into Claude skill packs / n8n / Zapier so the brain doesn't just observe — it executes.
- **Editor integration (Team tier):** every Claude Code / Cursor user calls the brain as MCP tools — `search_brain`, `get_page`, `list_patterns`, `trigger_workflow` — without leaving their editor.

## Who's it for?

- **Personal tier:** founders, solo operators, individual contributors who want their own knowledge graph from their work tools without trusting a third party.
- **Team tier:** 20–200-person companies (typically Series A/B, AI-native or AI-curious) where information is fragmented across Slack, email, and ticket tools; new hires take weeks to find context; and your CISO won't let you ship customer emails to a SaaS vendor.

## Why is this different from Amazon Quick / gbrain / Tolaria / other "company brains"?

- **vs. Amazon Quick:** Quick sends your data to AWS. Workflow Miner Personal keeps it on your Mac; Workflow Miner Team keeps it in your own Supabase. Same intelligence, none of the trust ask.
- **vs. [Garry Tan's gbrain](https://github.com/garrytan/gbrain):** same data model (`brain_pages` with compiled_truth + timeline + frontmatter + cross-links + pgvector — you can swap to gbrain CLI on the same vault). We add: automatic ingest from team SaaS, multi-user team mode, an MCP server for editor integration, and a packaged Mac app for individuals.
- **vs. [Tolaria](https://github.com/refactoringhq/tolaria):** Tolaria is the manual notes-app version (you type notes, it organizes them). Workflow Miner is the automatic ingest version (we pull from your work tools). Workflow Miner's Markdown export writes a gbrain-format vault Tolaria can open directly — they compose, they don't compete.

> **Trust-segment alliance.** Workflow Miner, gbrain, and Tolaria are three points on the same line — desktop-first, file/local-DB-backed, MCP-exposed knowledge tools. Tolaria for the knowledge you choose to write down. gbrain for personal LLM memory. Workflow Miner for the knowledge already happening in your tools. Same vault format; pick the right tool per use case.

## Install — Personal tier (~5 min)

1. Download `Workflow Miner_<version>_universal.dmg` from [the latest release](https://github.com/iamgagan/workflow-miner/releases/latest).
2. Mount the DMG and drag **Workflow Miner.app** to **Applications**. The build is notarized — Gatekeeper will accept it on first launch.
3. Launch the app. On first run it registers a per-install device token with our cloud proxy (anonymous, no signup) so you immediately get the 100k-tokens/month AI quota.
4. Connect Gmail / Slack / Linear / Calendar / GitHub / Notion / Jira / Outlook via OAuth — credentials land in your macOS Keychain.
5. Hit **Sync** and let the brain populate over a few minutes. **Patterns** appear automatically as workflows recur.
6. Open **Brain** (sidebar) to chat. Run **Dream Cycle** in Settings to embed the new timeline so the chat has something to similarity-search.

Source: [`apps/desktop/README.md`](apps/desktop/README.md).

## Install — Team tier (~15 min)

1. Create a [Supabase](https://app.supabase.com) project (free tier works).
2. Run [`packages/engine/src/brain/schema.sql`](packages/engine/src/brain/schema.sql) in the SQL editor.
3. In Supabase Auth → Providers, enable Email + Google. Set Allowed Email Domains to your company domain.
4. Deploy to Vercel with the env vars in [`.env.example`](.env.example).
5. Sign in at `<your-domain>/login`, hit `/brain`, ask a question.
6. Optional: add `@workflow-miner/mcp` to your Claude Code config to query the brain from your editor.

Detailed setup in [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## For engineers — how it's wired

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│  Connectors     │───▶│  Ingest           │───▶│  Brain store        │
│  (Gmail/Slack/  │    │  (engine)         │    │  Cloud → Supabase    │
│   Linear/...)   │    │  normalize→write  │    │  Desktop → PGlite   │
└─────────────────┘    └──────────────────┘    └──────────┬──────────┘
                                                          │
                       ┌────────────────────┐  ┌──────────▼──────────┐
                       │  PrefixSpan mining │  │  Brain agent         │
                       │  + LLM classifier  │  │  (gpt-4o via OR)     │
                       │  → patterns        │  │  /brain  /api/...   │
                       └────────────────────┘  └──────────────────────┘

           ┌─ Desktop only ────────────────────────────────────────┐
           │  All LLM calls (chat / embeddings / classification)   │
           │  route through the cloud LLM proxy with a per-install │
           │  Bearer token.                                        │
           │                                                       │
           │  workflow-miner.vercel.app/api/llm/[provider]/...     │
           │   ├── auth: SHA-256(device_token) lookup              │
           │   ├── quota: atomic spend via Postgres function       │
           │   └── forward: OpenRouter (chat + embeddings)         │
           └───────────────────────────────────────────────────────┘
```

**Components:**

- **Brain store** — Cloud uses Supabase Postgres + pgvector + RLS; desktop uses PGlite (embedded WASM Postgres) with the same schema and pgvector extension, so `/brain`'s vector RPCs work locally.
- **LLM proxy** — A tiny Next.js route (`/api/llm/[...path]`) that authenticates via per-install Bearer token, checks remaining quota in `desktop_devices`, forwards the request to OpenRouter, and decrements quota on the way back. Lets the desktop app ship without embedding the founder's API keys.
- **MCP server** (`@workflow-miner/mcp`) — Standalone npm package, stdio MCP server with 5 tools (`search_brain`, `get_page`, `list_recent_activity`, `list_patterns`, `trigger_workflow`). Talks to a hosted Workflow Miner instance via Bearer-token API.
- **Dream Cycles** — Scheduled LLM enrichment. Cloud runs as Inngest cron; desktop runs the same logic inline via `/api/dream/run`. Refreshes compiled truths + extracts entities + backfills timeline embeddings.
- **Markdown export** — `/api/export/run`. Cloud pushes a gbrain-format mirror to a GitHub repo (one-way, Postgres → Markdown). Desktop writes the same files to `~/Documents/Workflow Miner/export/`.

> **Deployment model: one Supabase project per company.** Multi-tenancy is achieved by isolation of deployments — your data sits in the Supabase project you control, never on someone else's servers. There is no shared SaaS to trust.

## Architecture

```
workflow-miner/
├── apps/
│   ├── web/                  # Next.js 15 dashboard + APIs
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (dashboard)/  # connectors, patterns, skills, settings
│   │       │   ├── brain/        # the chat UI for the Company Brain agent
│   │       │   ├── login/        # magic link + Google OAuth signin
│   │       │   ├── auth/callback # OAuth + magic link landing
│   │       │   └── api/
│   │       │       ├── brain/agent       # streaming agent (Vercel AI SDK)
│   │       │       ├── inngest           # Inngest webhook
│   │       │       ├── sync              # dispatches sync jobs to Inngest
│   │       │       └── connectors/...
│   │       ├── inngest/          # Inngest client + functions
│   │       │                     #  - syncCompanyData (per-source sync)
│   │       │                     #  - executePattern (workflow trigger)
│   │       └── lib/supabase/     # Supabase factories (browser/server/admin)
│   └── desktop/              # Personal tier: macOS Tauri shell + PGlite (single-user, local)
└── packages/
    └── engine/               # @workflow-miner/engine
        └── src/
            ├── connectors/   # Gmail, Slack, Linear, Calendar, GitHub, Notion, Jira, Outlook
            ├── mining/       # PrefixSpan pattern detection
            ├── normalize/    # Raw events → standard schema
            ├── brain/        # schema.sql (RLS, pgvector, RPCs)
            ├── pipeline/     # Ingestion orchestration
            ├── compiler/     # Pattern → Claude skill pack
            └── cli/          # CLI commands
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind, Radix UI, Framer Motion, Recharts |
| Backend | Next.js API routes |
| Brain DB (cloud) | Supabase Postgres + `pgvector` + Row Level Security |
| Brain DB (desktop) | PGlite (embedded WASM Postgres) + `pgvector` extension |
| Desktop shell | Tauri 2.x, universal-apple-darwin (Apple Silicon + Intel) |
| Auth (cloud) | Supabase Auth — magic link + Google OAuth |
| Auth (desktop) | Anonymous device token in macOS Keychain; OAuth tokens for connectors also in Keychain |
| Background jobs (cloud) | Inngest (sync, embed, dream cycle, export) |
| Background jobs (desktop) | Inline runners — `runDreamCycle()`, `runMarkdownExportToDisk()`, no Inngest required |
| LLM provider | OpenRouter (consolidates chat + embeddings; single bill, single hard cap) |
| Chat model | `openai/gpt-4o` via Vercel AI SDK with tool use |
| Embeddings | `openai/text-embedding-3-small` (1536-dim, HNSW indexed in cloud, flat in desktop) |
| Pattern naming + event classification | `anthropic/claude-3.5-haiku` |
| Engine | TypeScript, PrefixSpan, Zod |
| Testing | Playwright (E2E), Vitest (web units), node:test (local-shim) |

## Getting started

### 1. Prerequisites

- Node.js >= 20, pnpm >= 8
- A [Supabase](https://app.supabase.com) project (free tier works) — **one per company**
- An [OpenRouter](https://openrouter.ai) API key with credits — chat (`anthropic/claude-3.5-haiku`, `openai/gpt-4o`) + embeddings (`openai/text-embedding-3-small`) all flow through the one provider, single bill, single hard cap. **Set a monthly cap** on the OpenRouter dashboard before deploying (suggested: $25 for an early alpha).
- (Optional, for production) An [Inngest](https://app.inngest.com) account for background jobs (sync cron, dream cycle cron, GitHub-export cron). The desktop tier doesn't need Inngest — it runs inline runners.

### 2. Install + configure

```bash
git clone https://github.com/iamgagan/workflow-miner
cd workflow-miner
pnpm install
cp .env.example apps/web/.env.local
$EDITOR apps/web/.env.local
```

Required env vars (also documented in `.env.example`):

```env
# Supabase (https://app.supabase.com → your project → Settings → API)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenRouter (chat + embeddings; sign up + set a hard monthly cap)
OPEN_ROUTER_API_KEY=

# Optional: enable LLM event classification on /api/patterns/mine
ENABLE_LLM_CLASSIFY=1

# Inngest (leave blank for local `npx inngest-cli dev`)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

> **Desktop note:** the `apps/desktop/scripts/build-next.mjs` step strips `OPEN_ROUTER_API_KEY` (and other personal keys) from `.env.local` before embedding it as `.env.production` in the `.app` bundle. The desktop app reaches LLM features via the cloud proxy with a per-install Bearer token, never with your raw provider key.

### 3. Apply the schema

In your Supabase project's SQL editor, run [`packages/engine/src/brain/schema.sql`](packages/engine/src/brain/schema.sql). This creates the brain tables (`brain_pages`, `brain_timeline`, `brain_links`, `brain_tags`), the HNSW indexes for vector search, the `match_timeline_entries` and `match_brain_pages` RPCs, and RLS policies that grant any authenticated user of this Supabase project full access to the brain.

### 4. Configure Supabase Auth

In your Supabase dashboard:
1. **Authentication → Providers → Email** — enable, allow magic links.
2. **Authentication → Providers → Google** — enable, paste your Google OAuth client ID + secret.
3. **Authentication → URL Configuration** — set **Site URL** to your deployment URL and add `<site>/auth/callback` as a **Redirect URL**.
4. **Authentication → Settings → Allowed Email Domains** — set this to your company domain (e.g. `acme.com`) so only your employees can sign in. This is the gate that keeps your company brain to your company.

### 5. Run

```bash
# In one terminal — Next.js
pnpm --filter web dev

# In another — local Inngest dev server
npx inngest-cli@latest dev
```

Open <http://localhost:3000>, sign in via magic link, and visit `/brain` to chat with the Company Brain agent. Visit `/connectors` to wire up Gmail/Slack/etc.

## Two product modes

| Mode | DB | Auth | Distribution | Status |
|------|----|------|--------------|--------|
| **Company Brain (self-hosted)** | Supabase Postgres + pgvector + RLS — your project | Supabase Auth (magic link / Google), domain-gated | Each company deploys their own instance | **Active** |
| **Local-first Mac app** | PGlite (file in `~/Library/Application Support/WorkflowMiner/brain`) with pgvector + brain RPCs | Anonymous device token in macOS Keychain (single user) | Signed + notarized `.app` (universal binary), Tauri shell | **Active — v0.1.0-alpha.4** |

The cloud product is **single-tenant per deployment** — one Supabase project = one company. Multi-tenancy is achieved by isolation of deployments, not by row-level tenant filtering. Every employee of the company shares the same brain. To onboard a teammate, add their email domain to your Supabase project's allowed list and have them visit `/login`.

The desktop product is **single-user per install** — your Mac, your brain. LLM features (chat / embeddings / classification) call our cloud proxy with a per-install Bearer token; the proxy enforces a 100k tokens/month free quota and forwards to OpenRouter. Power users can swap to BYOK by setting `OPEN_ROUTER_API_KEY` in their environment (the desktop classifier reads env vars before falling back to the proxy).

## Pipeline

```
1. SYNC      User triggers `/api/sync?source=...`. Cloud dispatches a
             `company/sync.requested` Inngest event; desktop runs `runIngest`
             inline against the local PGlite brain via LocalBrainClient.
2. INGEST    Connector pulls events → Normalizer maps to standard shape →
             writer upserts `brain_pages` and inserts `brain_timeline` rows.
             Cloud also embeds each page/timeline entry with text-embedding-3
             at write time.
3. CLASSIFY  When `ENABLE_LLM_CLASSIFY=1`, batched LLM calls map each timeline
             summary to a fixed event-type taxonomy (bug_reported,
             meeting_scheduled, code_reviewed, …) and extract actor + objectRef
             anchors. Falls back to regex `deriveEventType` per row on failure.
4. MINE      PrefixSpan over the (sessionized) timeline detects repeated
             subsequences. Quality gates (support ≥ 3, ≥ 2 distinct event
             types, ≥ 2 source systems) drop degenerate runs. Each surviving
             pattern lands as a `brain_pages` row of `type='workflow'` with a
             PatternScorer composite score and an LLM-generated human name.
5. ASK       The /brain chat UI streams from `/api/brain/agent` (gpt-4o via
             OpenRouter) which can call `searchCompanyKnowledge` (HNSW cosine
             search via `match_timeline_entries`), `getOrganizationPatterns`,
             and `triggerWorkflow` (dispatches to Inngest's `executePattern`).
6. ENRICH    Dream Cycle (`runDreamCycle()` or Inngest `dreamCycle` cron)
             refreshes compiled_truth on touched pages, extracts entities,
             re-embeds, and backfills timeline embeddings so /brain has fresh
             context to search.
7. EXPORT    `runMarkdownExportToDisk()` (desktop) or `exportToGit` Inngest
             function (cloud) writes a gbrain-format markdown mirror of the
             brain. Patterns can also be compiled into Claude skill packs /
             n8n / Zapier via the `/skills` route.
```

## Onboarding teammates

Just have them visit `/login` and sign in with their company-domain email. Supabase's allowed-email-domains setting is the gate.

There is no invite/accept flow because there's nothing to invite *to* — every authenticated user of this Supabase project sees the same brain by design. If you want to restrict access more finely (e.g. only certain employees), use Supabase's row-level security policies.

## API reference

### Brain agent
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/brain/agent` | Streaming chat with `openai/gpt-4o` via OpenRouter; tools: `searchCompanyKnowledge`, `getOrganizationPatterns`, `triggerWorkflow` |

### LLM proxy (cloud-hosted, used by desktop installs)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/llm/openrouter/chat/completions` | Bearer-auth proxy to OpenRouter chat. Supports streaming. Decrements per-device quota via atomic `desktop_device_spend()`. |
| `POST` | `/api/llm/openrouter/embeddings` | Bearer-auth proxy to OpenRouter embeddings. |
| `POST` | `/api/devices/register` | First-launch device registration. Returns a one-time plaintext Bearer token + initial 100k-token quota. |
| `GET`  | `/api/devices/status` | Returns current quota state (`used_this_period / monthly_quota_tokens`, days until reset). Mode-aware: desktop reads its local token and forwards. |

### Patterns
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/patterns` | List mined patterns with scores |
| `GET`  | `/api/patterns/[id]` | Single pattern details |
| `GET`  | `/api/patterns/[id]/evidence` | Supporting events for a pattern |
| `POST` | `/api/patterns/mine` | Trigger pattern mining (PrefixSpan + LLM classifier when `ENABLE_LLM_CLASSIFY=1`) |
| `PATCH`| `/api/patterns/[id]` | Update userStatus (confirmed/rejected/draft) |

### Background jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| `*`    | `/api/inngest` | Inngest webhook (cloud only — handles `company/sync.requested`, `pattern/execute.requested`, `dream/cycle.requested`, `export/run.requested`) |
| `POST` | `/api/sync?source=all` | Dispatches sync jobs (cloud) or runs `runIngest` inline (desktop) |
| `POST` | `/api/dream/run` | Runs Dream Cycle. Cloud: dispatches Inngest event. Desktop: calls `runDreamCycle()` inline, returns `{pagesEnriched, timelineEmbeddingsBackfilled}` synchronously |
| `POST` | `/api/export/run` | Runs Markdown export. Cloud: GitHub push. Desktop: writes to `~/Documents/Workflow Miner/export/`, returns `{outputDir, exported, skipped}` |

### Connectors
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/connectors/status` | Connection status for all providers |
| `GET`  | `/api/connectors/google/authorize` | Start Google OAuth flow |
| `GET`  | `/api/connectors/google/callback` | OAuth callback — stores tokens |
| `GET`/`POST`/`DELETE` | `/api/connectors/manual-token` | Slack/Linear/etc. paste-token flow |

### Data (read paths)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/dashboard` | Dashboard stats (events, patterns, sources) |
| `GET`  | `/api/activity` | Recent activity timeline |
| `GET`  | `/api/health` | Public health check (`web` + `supabase` status) |

### Dev / admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/seed-brain` | Insert sample brain data (idempotent) |
| `POST` | `/api/admin/reset-brain` | Wipe local brain timeline + workflow pages |
| `POST` | `/api/admin/setup-brain` | Initialize brain tables (idempotent) |

## Testing

```bash
# Engine unit tests
pnpm --filter @workflow-miner/engine test

# Web units (vitest — dream-cycle entity extraction, mcp-auth hashing, markdown rendering)
pnpm --filter web test

# Local-shim node:test (PGlite-backed, real schema)
cd apps/web && node --experimental-strip-types --test src/lib/supabase/local-shim.test.ts

# Offline LLM classifier comparison (regex vs LLM, side-by-side)
OPEN_ROUTER_API_KEY=sk-or-v1-... pnpm dlx tsx apps/web/scripts/classify-harness.ts

# Web E2E (Playwright)
cd apps/web && npx playwright test
```

## Deployment

The cloud product deploys cleanly to **Vercel**. Each company creates their own Vercel project, sets every env var from `.env.example`, and points their Supabase project's redirect URL at `<site>/auth/callback`. Run the `inngest-cli` either as a Vercel cron, on Inngest's hosted runner, or alongside your own infra. See [`docs/DEPLOY.md`](docs/DEPLOY.md) if it exists, or the existing `vercel.json` in the repo root.

## License

AGPL-3.0-or-later. See [`LICENSE`](LICENSE). Anything you derive from this code stays open under the same license.
