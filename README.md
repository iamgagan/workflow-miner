# Workflow Miner

> **The Company Brain that actually works on your company's data.** Plug in Gmail, Slack, Linear, Calendar, GitHub, Notion, Jira, Outlook → get a searchable, queryable, agent-callable brain that knows what your team is doing this week, what the patterns are, and how to trigger them.

## What is this?

Most teams have their knowledge scattered across 8 SaaS tools. Workflow Miner pulls events from all of them, embeds each one into a vector store, mines the recurring patterns your team actually repeats, and exposes the result three ways:

- **Chat:** ask the `/brain` agent in natural language ("what did the engineering team decide about Postgres last week?") and get an answer with sources.
- **Editor:** every Claude Code / Cursor user in your company can call the brain as MCP tools — `search_brain`, `get_page`, `list_patterns`, `trigger_workflow` — without leaving their editor.
- **Automation:** detected workflow patterns (e.g. "support email → Linear ticket → draft reply") compile into Claude skill packs / n8n / Zapier so the brain doesn't just observe — it executes.

## Who's it for?

20–200-person companies (typically Series A/B, AI-native or AI-curious) where:
- Information is fragmented across Slack, email, and ticket tools
- New hires take weeks to find context
- The same workflows repeat constantly but nobody's automated them
- You don't want your data sitting on a third-party SaaS

## Why is this different from gbrain / other "company brains"?

- **Same data model as [Garry Tan's gbrain](https://github.com/garrytan/gbrain)** — `brain_pages` with compiled_truth + timeline + frontmatter + cross-links + pgvector. You can swap to gbrain CLI on the same vault. We add: automatic ingest from team SaaS, multi-user via Supabase Auth, and an MCP server for editor integration.
- **You own everything.** One Supabase project per company — your account, your data, your billing. We never see it. Self-hosted on Vercel + Supabase = your infra, your control. No SaaS middleman.
- **Already shipped infrastructure.** 18 implementation tasks, 21 unit tests, 46 routes, working agent loop — not a deck.

## Install (~15 min)

1. Create a [Supabase](https://app.supabase.com) project (free tier works).
2. Run [`packages/engine/src/brain/schema.sql`](packages/engine/src/brain/schema.sql) in the SQL editor.
3. In Supabase Auth → Providers, enable Email + Google. Set Allowed Email Domains to your company domain.
4. Deploy to Vercel with the env vars in [`.env.example`](.env.example).
5. Sign in at `<your-domain>/login`, hit `/brain`, ask a question.
6. Optional: add `@workflow-miner/mcp` to your Claude Code config to query the brain from your editor.

Detailed setup is below.

---

## For engineers — how it's wired

```
┌─────────────────┐    ┌────────────────┐    ┌─────────────────┐
│  Connectors     │───▶│  Inngest sync  │───▶│  Supabase brain │
│  (Gmail/Slack/  │    │  + embed step  │    │  (pgvector,     │
│   Linear/...)   │    │  (text-embed-3)│    │   per-company)  │
└─────────────────┘    └────────────────┘    └────────┬────────┘
                                                      │
                                            ┌─────────▼─────────┐
                                            │  Brain agent      │
                                            │  (gpt-4o + tools) │
                                            │  /brain  /api/... │
                                            └───────────────────┘
```

Plus: **Dream Cycles** (nightly LLM enrichment — extract entities, refresh summaries, re-embed), **MCP server** (`@workflow-miner/mcp` — stdio CLI for any MCP client), **Markdown export** (push gbrain-format `.md` files to a GitHub repo you own).

> **Deployment model: one Supabase project per company.** Multi-tenancy is achieved by isolation of deployments — your data sits in the Supabase project you control, never on someone else's servers. There is no shared SaaS to trust.

> **About the desktop app.** A local-first macOS app shipped as v0.1.0-alpha.1 on 2026-04-28 (Tauri shell + PGlite). It is now **frozen** while the cloud Company Brain is the active product line — see [`apps/desktop/README.md`](apps/desktop/README.md) for the snapshot and how to revive the local-first build.

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
│   └── desktop/              # FROZEN: macOS Tauri shell from v0.1.0-alpha.1
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
| Brain DB | Supabase Postgres + `pgvector` + Row Level Security |
| Auth | Supabase Auth — magic link + Google OAuth |
| Background jobs | Inngest (sync, embed, pattern execute) |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim, HNSW indexed) |
| Brain agent | OpenAI `gpt-4o` via Vercel AI SDK with tool use |
| Engine | TypeScript, PrefixSpan, Zod |
| Testing | Playwright (E2E), Vitest (engine units) |

## Getting started

### 1. Prerequisites

- Node.js >= 20, pnpm >= 8
- A [Supabase](https://app.supabase.com) project (free tier works) — **one per company**
- An [OpenAI](https://platform.openai.com) API key with access to `text-embedding-3-small` and `gpt-4o`
- (Optional, for production) An [Inngest](https://app.inngest.com) account for background jobs

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

# OpenAI (embeddings + brain agent)
OPENAI_API_KEY=

# Inngest (leave blank for local `npx inngest-cli dev`)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

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
| Local-first Mac app | PGlite (file in `~/Library/Application Support/WorkflowMiner/brain`) | macOS Keychain (single user) | Signed `.app`, Tauri shell | Frozen at v0.1.0-alpha.1 |

The cloud product is **single-tenant per deployment** — one Supabase project = one company. Multi-tenancy is achieved by isolation of deployments, not by row-level tenant filtering. Every employee of the company shares the same brain. To onboard a teammate, add their email domain to your Supabase project's allowed list and have them visit `/login`.

## Pipeline

```
1. SYNC      User triggers `/api/sync?source=...`. The route dispatches a
             `company/sync.requested` event per source to Inngest.
2. INGEST    Inngest's `syncCompanyData` function pulls the connector,
             normalizes events, and writes to `brain_pages` / `brain_timeline`
             via CloudBrainClient — embedding each page and timeline entry on
             write with `text-embedding-3-small`.
3. MINE      PrefixSpan over the timeline detects repeated subsequences;
             each pattern lands as a `brain_pages` row of `type='pattern'`.
4. ASK       The /brain chat UI streams from `/api/brain/agent` (gpt-4o)
             which can call `searchCompanyKnowledge` (HNSW cosine search via
             `match_timeline_entries`), `getOrganizationPatterns`, and
             `triggerWorkflow` (dispatches to Inngest's `executePattern`).
5. EXPORT    Patterns can be compiled into Claude skill packs / n8n / Zapier
             via the `/skills` route (the desktop alpha's compiler is reused).
```

## Onboarding teammates

Just have them visit `/login` and sign in with their company-domain email. Supabase's allowed-email-domains setting is the gate.

There is no invite/accept flow because there's nothing to invite *to* — every authenticated user of this Supabase project sees the same brain by design. If you want to restrict access more finely (e.g. only certain employees), use Supabase's row-level security policies.

## API reference

### Brain agent
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/brain/agent` | Streaming chat with `gpt-4o`, tools: `searchCompanyKnowledge`, `getOrganizationPatterns`, `triggerWorkflow` |

### Background jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| `*`    | `/api/inngest` | Inngest webhook (handles `company/sync.requested`, `pattern/execute.requested`) |
| `POST` | `/api/sync?source=all` | Dispatches sync jobs |

### Connectors
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/connectors/status` | Connection status for all providers |
| `GET`  | `/api/connectors/google/authorize` | Start Google OAuth flow |
| `GET`  | `/api/connectors/google/callback` | OAuth callback — stores tokens |

### Data (read paths)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/dashboard` | Dashboard stats (events, patterns, sources) |
| `GET`  | `/api/activity` | Recent activity timeline |
| `GET`  | `/api/patterns` | Detected patterns with scores |
| `GET`  | `/api/patterns/[id]` | Single pattern details |
| `GET`  | `/api/patterns/[id]/evidence` | Supporting events for a pattern |

### Dev / admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/seed` | Insert sample brain data (dev only — disabled in `NODE_ENV=production`) |
| `POST` | `/api/admin/setup-brain` | Initialize brain tables (idempotent) |

## Testing

```bash
# Engine unit tests
pnpm --filter @workflow-miner/engine test

# Web E2E (Playwright)
cd apps/web && npx playwright test
```

## Deployment

The cloud product deploys cleanly to **Vercel**. Each company creates their own Vercel project, sets every env var from `.env.example`, and points their Supabase project's redirect URL at `<site>/auth/callback`. Run the `inngest-cli` either as a Vercel cron, on Inngest's hosted runner, or alongside your own infra. See [`docs/DEPLOY.md`](docs/DEPLOY.md) if it exists, or the existing `vercel.json` in the repo root.

## License

Private — All rights reserved.
