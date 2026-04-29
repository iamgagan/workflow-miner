# Workflow Miner — Company Brain

**An observability + RAG layer for how your company actually works.** Workflow Miner connects to Gmail, Slack, Linear, Google Calendar, GitHub, Notion, Jira, and Outlook; embeds every event into a vector-searchable brain; mines the recurring patterns your team repeats; and exposes the result as **a chat agent** that can answer questions across the whole knowledge graph and trigger detected workflows on demand.

```
┌─────────────────┐    ┌────────────────┐    ┌─────────────────┐
│  Connectors     │───▶│  Inngest sync  │───▶│  Supabase brain │
│  (Gmail/Slack/  │    │  + embed step  │    │  (pgvector,     │
│   Linear/...)   │    │  (text-embed-3)│    │   RLS by org)   │
└─────────────────┘    └────────────────┘    └────────┬────────┘
                                                      │
                                            ┌─────────▼─────────┐
                                            │  Brain agent      │
                                            │  (gpt-4o + tools) │
                                            │  /brain  /api/... │
                                            └───────────────────┘
```

> **About the desktop app.** A local-first macOS app shipped as v0.1.0-alpha.1 on 2026-04-28 (Tauri shell + PGlite). It is now **frozen** while the cloud Company Brain is the active product line — see [`apps/desktop/README.md`](apps/desktop/README.md) for the snapshot and how to revive the local-first build.

## Architecture

```
workflow-miner/
├── apps/
│   ├── web/                  # Next.js 15 dashboard + APIs (the cloud product)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (dashboard)/  # connectors, patterns, skills, settings
│   │       │   ├── brain/        # the chat UI for the Company Brain agent
│   │       │   ├── login/        # magic link + Google OAuth signin
│   │       │   ├── invite/accept # team-invite redemption
│   │       │   ├── auth/callback # OAuth + magic link landing
│   │       │   └── api/
│   │       │       ├── brain/agent       # streaming agent (Vercel AI SDK)
│   │       │       ├── inngest           # Inngest webhook
│   │       │       ├── orgs/{invite,accept}
│   │       │       ├── sync              # dispatches sync jobs to Inngest
│   │       │       └── connectors/...
│   │       ├── inngest/          # Inngest client + functions
│   │       │                     #  - syncOrganizationData (per-source sync)
│   │       │                     #  - executePattern (workflow trigger)
│   │       └── lib/supabase/     # cloud Supabase factories (browser/server/admin)
│   └── desktop/              # FROZEN: macOS Tauri shell from v0.1.0-alpha.1
└── packages/
    └── engine/               # @workflow-miner/engine
        └── src/
            ├── connectors/   # Gmail, Slack, Linear, Calendar, GitHub, Notion, Jira, Outlook
            ├── mining/       # PrefixSpan pattern detection
            ├── normalize/    # Raw events → standard schema
            ├── brain/        # schema.sql (RLS, pgvector, RPCs, org trigger)
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
- A [Supabase](https://app.supabase.com) project (free tier works)
- An [OpenAI](https://platform.openai.com) API key with access to `text-embedding-3-small` and `gpt-4o`
- (Optional, for production) An [Inngest](https://app.inngest.com) account for background jobs

### 2. Install + configure

```bash
git clone https://github.com/iamgagan/workflow-miner
cd workflow-miner
pnpm install
cp .env.example .env.local
$EDITOR .env.local
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

In your Supabase project's SQL editor, run [`packages/engine/src/brain/schema.sql`](packages/engine/src/brain/schema.sql). This creates the brain tables (`brain_pages`, `brain_timeline`, `brain_links`, `brain_tags`), the multi-tenant indexes, the HNSW indexes for vector search, the `match_timeline_entries` and `match_brain_pages` RPCs, the `provision_user_organization` trigger that auto-assigns each new user a personal org, and the `org_members` / `org_invites` tables for team workspaces.

### 4. Configure Supabase Auth

In your Supabase dashboard:
1. **Authentication → Providers → Email** — enable, allow magic links.
2. **Authentication → Providers → Google** — enable, paste your Google OAuth client ID + secret.
3. **Authentication → URL Configuration** — set **Site URL** to your deployment URL and add `<site>/auth/callback` as a **Redirect URL**.

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
| **Company Brain (cloud)** | Supabase Postgres + pgvector + RLS | Supabase Auth (magic link / Google) | Web app, multi-tenant | **Active** |
| Local-first Mac app | PGlite (file in `~/Library/Application Support/WorkflowMiner/brain`) | macOS Keychain (single user) | Signed `.app`, Tauri shell | Frozen at v0.1.0-alpha.1 |

The cloud product is multi-tenant by `organization_id`. Every table is RLS-scoped, every embedding is HNSW-indexed, and every multi-user workspace is invite-based via `/api/orgs/invite` + `/api/orgs/accept`.

## Pipeline

```
1. SYNC      User triggers `/api/sync?source=...`. The route dispatches an
             `org/sync.requested` event per source to Inngest.
2. INGEST    Inngest's `syncOrganizationData` function pulls the connector,
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

## Inviting teammates

```bash
# Sign in as the org owner, then:
curl -X POST $SITE/api/orgs/invite \
  -H "Cookie: $YOUR_SUPABASE_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"email": "teammate@yourcompany.com"}'
# → { inviteUrl: "https://.../invite/accept?token=..." }
```

Send the URL to your teammate. After they sign in and accept, their JWT carries the org's `organization_id` and RLS lets them see the same brain.

## API reference (cloud product)

### Brain agent
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/brain/agent` | Streaming chat with `gpt-4o`, tools: `searchCompanyKnowledge`, `getOrganizationPatterns`, `triggerWorkflow` |

### Org management
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/orgs/invite` | Issue an invite token for a teammate |
| `POST` | `/api/orgs/accept` | Redeem an invite token; calls `accept_org_invite()` |

### Background jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| `*`    | `/api/inngest` | Inngest webhook (handles `org/sync.requested`, `pattern/execute.requested`) |
| `POST` | `/api/sync?source=all` | Dispatches sync jobs for the caller's org |

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

The cloud product deploys cleanly to **Vercel**. Set every env var from `.env.example` in the Vercel project, point your Supabase project's redirect URL at `<site>/auth/callback`, and run the `inngest-cli` either as a Vercel cron, on Inngest's hosted runner, or alongside your own infra. See [`docs/DEPLOY.md`](docs/DEPLOY.md) if it exists, or the existing `vercel.json` in the repo root.

## License

Private — All rights reserved.
