# Workflow Miner

> **A brain that knows how your company actually works — without giving Amazon, Microsoft, or anyone else a copy.** Plug in Gmail, Slack, Linear, Calendar, GitHub, Notion, Jira, Outlook → get a searchable, queryable, agent-callable brain. Two tiers, same codebase, you pick the one that matches your trust threshold.

## Two tiers

|  | **Personal** (Mac app) | **Team** (cloud, self-hosted) |
|---|---|---|
| **Who** | One person, your laptop | A whole company |
| **Where data lives** | PGlite file in `~/Library/Application Support/WorkflowMiner/brain` on your Mac | Your own Supabase project, in your own cloud account |
| **Network** | None for the brain itself; OpenAI calls only when you opt in | Standard cloud — Supabase + Vercel + OpenAI + Inngest, all in your accounts |
| **Trust ask** | None. Verifiable with Activity Monitor / Wireshark | Trust your own AWS-hosted Supabase + Vercel |
| **Auth** | macOS Keychain, single local user | Supabase Auth with magic link / Google, gated by allowed-email-domains |
| **Multi-user** | No (one Mac = one brain) | Yes (every authenticated user in the Supabase project shares the brain) |
| **Distribution** | Signed `.app` download | One Vercel + Supabase deploy per company |
| **Status** | v0.1.0-alpha.1 shipped 2026-04-28 | Production-ready as of `main` |
| **Cost** | Free (you pay OpenAI usage if you use the chat agent) | Supabase + Vercel + OpenAI + Inngest at your usage tiers |

> **Why both?** A brain that observes one person's workflow can absolutely live on that person's machine — that's the Personal tier, and it can honestly say "your data never leaves your Mac." A brain shared across a team needs a central store; the Team tier puts that store in *your company's* infrastructure, not ours. Either tier, no third party sees your data.

## What it does (both tiers)

- **Chat:** ask the `/brain` agent in natural language ("what did the team decide about Postgres last week?") and get an answer with sources.
- **Editor (Team tier):** every Claude Code / Cursor user calls the brain as MCP tools — `search_brain`, `get_page`, `list_patterns`, `trigger_workflow` — without leaving their editor.
- **Automation:** detected workflow patterns (e.g. "support email → Linear ticket → draft reply") compile into Claude skill packs / n8n / Zapier so the brain doesn't just observe — it executes.

## Who's it for?

- **Personal tier:** founders, solo operators, individual contributors who want their own knowledge graph from their work tools without trusting a third party.
- **Team tier:** 20–200-person companies (typically Series A/B, AI-native or AI-curious) where information is fragmented across Slack, email, and ticket tools; new hires take weeks to find context; and your CISO won't let you ship customer emails to a SaaS vendor.

## Why is this different from Amazon Quick / gbrain / Tolaria / other "company brains"?

- **vs. Amazon Quick:** Quick sends your data to AWS. Workflow Miner Personal keeps it on your Mac; Workflow Miner Team keeps it in your own Supabase. Same intelligence, none of the trust ask.
- **vs. [Garry Tan's gbrain](https://github.com/garrytan/gbrain):** same data model (`brain_pages` with compiled_truth + timeline + frontmatter + cross-links + pgvector — you can swap to gbrain CLI on the same vault). We add: automatic ingest from team SaaS, multi-user team mode, an MCP server for editor integration, and a packaged Mac app for individuals.
- **vs. [Tolaria](https://github.com/refactoringhq/tolaria):** Tolaria is the manual notes-app version (you type notes, it organizes them). Workflow Miner is the automatic ingest version (we pull from your work tools). Workflow Miner's Markdown export writes a gbrain-format vault Tolaria can open directly — they compose, they don't compete.

> **Trust-segment alliance.** Workflow Miner, gbrain, and Tolaria are three points on the same line — desktop-first, file/local-DB-backed, MCP-exposed knowledge tools. Tolaria for the knowledge you choose to write down. gbrain for personal LLM memory. Workflow Miner for the knowledge already happening in your tools. Same vault format; pick the right tool per use case.

## Install — Personal tier (~5 min)

1. Download the signed `.app` from [the latest release](https://github.com/iamgagan/workflow-miner/releases/latest).
2. Open it. Right-click → Open the first time (unsigned-build caveat).
3. Connect your Gmail / Slack / Linear via OAuth — credentials go into your macOS Keychain.
4. Hit "Sync Now" and let the brain populate over a few minutes.
5. Ask the `/brain` chat anything.

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
