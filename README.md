# Workflow Miner

Detect recurring workflow patterns across Gmail, Slack, Linear, and Google Calendar. Export them as deployable Claude skill packs.

Workflow Miner watches your daily work tools, identifies repeating sequences (bug triage flows, feature development pipelines, customer escalation paths), and surfaces them as actionable patterns with confidence scores.

It runs in two flavors:

- **Desktop app (macOS)** — local-first, your data never leaves your Mac. Brain database is an embedded Postgres (PGlite); OAuth secrets live in the macOS Keychain. See [`apps/desktop/README.md`](apps/desktop/README.md).
- **Hosted web app** — same Next.js dashboard backed by Supabase, deployable to Vercel. Useful for teams that want a shared workspace; see the deployment section below.

## Architecture

```
workflow-miner-monorepo/
├── apps/
│   ├── web/                  # Next.js 15 dashboard + API
│   │   ├── src/
│   │   │   ├── app/          # Pages & API routes
│   │   │   ├── components/   # React components (shadcn/ui)
│   │   │   └── lib/          # Supabase clients, local-shim, utilities
│   │   └── e2e/              # Playwright E2E tests
│   └── desktop/              # macOS Tauri shell (wraps apps/web locally)
│       ├── src-tauri/        # Rust shell, Keychain, OAuth loopback
│       ├── scripts/          # Next.js sidecar bootstrap + build helpers
│       └── resources/        # Splash + bundled standalone Next.js output
├── packages/
│   └── engine/               # @workflow-miner/engine
│       └── src/
│           ├── connectors/   # Gmail, Slack, Linear, Calendar APIs
│           ├── mining/       # PrefixSpan pattern detection
│           ├── normalize/    # Raw events → standard schema
│           ├── brain/        # Supabase persistence layer
│           ├── pipeline/     # Ingestion orchestration
│           ├── compiler/     # Pattern → Claude skill pack
│           └── cli/          # CLI commands
└── vercel.json               # Deployment config
```

### Desktop vs hosted: how the same code runs in both

The desktop app reuses the entire Next.js dashboard. The single switch is the `WORKFLOW_MINER_MODE=desktop` environment variable that the Tauri shell sets when spawning the Next.js sidecar:

- **`apps/web/src/lib/supabase/local-shim.ts`** — a PGlite-backed shim that implements the small subset of the Supabase JS client (`from`, `select`, `eq`, `in`, `or`, `gte`, `lt`, `order`, `limit`, `single`, `insert`, `upsert`, `auth.getUser`) that the codebase actually calls. The existing `schema.sql` runs verbatim because PGlite is real WASM Postgres.
- **`apps/web/src/lib/supabase/{server,admin}.ts`** — env-gated factories that return either a real Supabase client or the local shim depending on `WORKFLOW_MINER_MODE`.
- **`apps/web/src/middleware.ts`** — skips auth in desktop mode (single local user).
- **`apps/web/src/lib/local-brain-client.ts`** — drop-in replacement for the engine's hosted `BrainClient`, used in desktop mode by the sync route.
- **`apps/web/src/lib/desktop-bridge.ts`** — renderer-side bridge into the Tauri shell for Keychain access and OAuth loopback flows.
- **`apps/desktop/src-tauri/`** — Rust shell that picks a free 127.0.0.1 port, spawns the Next.js sidecar, hosts macOS Keychain commands, and runs the OAuth loopback listener.

### Data Flow

```
1. SYNC     Connectors pull raw events from Gmail/Slack/Linear/Calendar
               ↓
2. NORMALIZE Events converted to standard schema (EventType, EntityType)
               ↓
3. INGEST   Normalized events written to brain_timeline (Supabase)
               ↓
4. MINE     Sessionizer groups by time gaps → PatternMiner detects sequences
               ↓
5. SCORE    Patterns ranked by frequency, recency, consistency, complexity
               ↓
6. EXPORT   Compile patterns into Claude skill packs (YAML/JSON)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS, Radix UI, Framer Motion, Recharts |
| Backend | Next.js API routes, Supabase (PostgreSQL + Auth + RLS) |
| Engine | TypeScript, PrefixSpan algorithm, Zod validation |
| LLM | OpenRouter (Claude) for chat coaching and nudges |
| Auth | Supabase Auth + middleware session checks |
| Testing | Playwright (E2E), Vitest (engine unit tests) |
| Deploy | Vercel |

## Getting Started

Pick the path that matches what you want to run.

### Path A — Desktop app (recommended for individuals)

Local-first. Runs only on your Mac, no Supabase, no hosted accounts.

```bash
brew install pnpm rustup
rustup-init -y
rustup target add aarch64-apple-darwin x86_64-apple-darwin

git clone <repo-url>
cd workflow-miner
pnpm install

# Configure Google OAuth (required for Gmail + Calendar)
cp apps/desktop/.env.example apps/desktop/.env.local
$EDITOR apps/desktop/.env.local

pnpm desktop:dev
```

See [`apps/desktop/README.md`](apps/desktop/README.md) for the full architecture, signing/notarization steps, and troubleshooting.

### Path B — Hosted web app

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8
- A [Supabase](https://supabase.com) project
- Google Cloud Console project (for Gmail + Calendar OAuth)
- [OpenRouter](https://openrouter.ai) API key (for LLM features)

### 1. Clone and Install

```bash
git clone <repo-url>
cd workflow-miner
pnpm install
```

### 2. Set Up Supabase

Create a Supabase project, then run these SQL commands in the SQL Editor:

**Brain tables** (via `/api/admin/setup-brain`):
```sql
-- brain_pages, brain_links, brain_tags, brain_timeline
-- These are created automatically when you hit POST /api/admin/setup-brain
```

**Connector tokens table:**
```sql
CREATE TABLE IF NOT EXISTS connector_tokens (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ,
  scopes TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

ALTER TABLE connector_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own tokens" ON connector_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### 3. Configure Environment Variables

Copy the example env files:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

**`apps/web/.env.local`** (required):

```env
# Supabase (from your project dashboard)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenRouter (for LLM chat + coaching)
OPEN_ROUTER_API_KEY=sk-or-v1-...

# Google OAuth (for Gmail + Calendar connectors)
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-...
```

**`.env`** (optional, for CLI engine usage):

```env
# Direct API tokens for CLI-only ingestion
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
SLACK_BOT_TOKEN=
LINEAR_API_KEY=
CALENDAR_CLIENT_ID=
CALENDAR_CLIENT_SECRET=
CALENDAR_REFRESH_TOKEN=

# Email digest delivery
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
REPORT_TO_EMAIL=
REPORT_FROM_EMAIL=
```

### 4. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable **Gmail API** and **Google Calendar API**
4. Create OAuth 2.0 credentials (Web application type)
5. Add authorized redirect URI: `http://localhost:3000/api/connectors/google/callback`
6. Copy Client ID and Client Secret to your `.env.local`

### 5. Build and Run

```bash
# Build the engine package first
pnpm --filter @workflow-miner/engine build

# Start the dev server
cd apps/web && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Initialize Brain Tables

Hit the admin endpoint to create brain tables:

```bash
curl -X POST http://localhost:3000/api/admin/setup-brain
```

## Usage

### Connecting Sources

1. Navigate to **/connectors**
2. Click **Connect with Google** to authorize Gmail + Calendar via OAuth
3. For Slack and Linear, add API tokens in the settings or `.env`
4. Click **Sync Now** to pull events from connected sources

### Viewing Patterns

After syncing data:

1. Go to **/patterns** to see detected workflow patterns
2. Click **Mine Patterns** to run the PrefixSpan algorithm on your timeline data
3. Each pattern shows:
   - **Confidence score** (composite of frequency, recency, consistency)
   - **Source breakdown** (which tools contribute)
   - **Workflow graph** (visual step sequence)
   - **Evidence panel** (supporting events)

### AI Coaching

The chat interface (bottom-right floating button) uses OpenRouter to provide:

- Workflow optimization suggestions
- Pattern-based insights
- Productivity coaching nudges

Coach nudges appear automatically based on detected patterns and activity trends.

### Exporting Skills

Navigate to **/skills** to export detected patterns as Claude skill packs that can be deployed to automate recurring workflows.

## Engine CLI

The engine package also works as a standalone CLI:

```bash
cd packages/engine

# Ingest from a specific source
npx workflow-miner ingest --source gmail

# Run pattern mining
npx workflow-miner mine

# Export patterns as skill packs
npx workflow-miner export --format yaml
```

## API Reference

### Data APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard` | Dashboard stats (events, patterns, sources) |
| `GET` | `/api/activity` | Recent activity timeline (20 entries) |
| `GET` | `/api/patterns` | List detected patterns with scores |
| `POST` | `/api/patterns/mine` | Trigger pattern mining on timeline data |
| `GET` | `/api/patterns/[id]` | Single pattern details |
| `GET` | `/api/patterns/[id]/evidence` | Evidence events for a pattern |

### Connector APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/connectors/status` | Connection status for all providers |
| `GET` | `/api/connectors/google/authorize` | Start Google OAuth flow |
| `GET` | `/api/connectors/google/callback` | OAuth callback (stores tokens) |
| `POST` | `/api/sync` | Sync all connected sources |

### AI APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | LLM coaching chat (OpenRouter) |
| `GET` | `/api/coach` | AI coaching nudges |

### Admin APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/setup-brain` | Initialize brain database tables |
| `POST` | `/api/admin/seed-brain` | Populate demo data (development only) |
| `GET` | `/api/digest` | Generate weekly digest |

## Testing

### E2E Tests (Playwright)

```bash
cd apps/web

# Run all 36 E2E tests
npx playwright test

# Run with UI
npx playwright test --ui

# Run specific test file
npx playwright test e2e/dashboard.spec.ts
```

Tests cover: auth pages, connectors, dashboard, landing page, navigation, onboarding, patterns, replay, settings, and skills.

### Engine Unit Tests (Vitest)

```bash
cd packages/engine
npm test
```

## Deployment

### Vercel (Production)

The project deploys to Vercel as a monorepo:

```bash
# Deploy to production
vercel deploy --prod
```

The `vercel.json` at the repo root configures:
- Build command: `pnpm run build`
- Output directory: `apps/web/.next`
- Weekly digest cron: Mondays at 9 AM UTC

### Environment Variables on Vercel

Set these in Vercel Dashboard > Project > Settings > Environment Variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPEN_ROUTER_API_KEY`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`

## Project Structure Details

### Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with hero, features, pattern demo |
| `/login` | Email/password authentication |
| `/signup` | Account creation |
| `/dashboard` | Main dashboard with stats, charts, recent patterns |
| `/patterns` | Browse and search detected patterns |
| `/patterns/[id]` | Pattern detail with workflow graph and evidence |
| `/connectors` | Manage OAuth connections to data sources |
| `/skills` | View and export skill packs |
| `/replay` | Replay workflow event sequences |
| `/settings` | User preferences and configuration |

### Engine Modules

| Module | Purpose |
|--------|---------|
| `connectors/` | Gmail, Slack, Linear, Calendar API integrations |
| `mining/` | PrefixSpan-based pattern detection + scoring |
| `normalize/` | Convert raw events to standard schema |
| `brain/` | Supabase persistence (timeline + pages) |
| `pipeline/` | Orchestrate ingest flow (connect → normalize → write) |
| `compiler/` | Generate Claude skill packs from patterns |
| `cli/` | Command-line interface for standalone usage |

## License

Private - All rights reserved.
