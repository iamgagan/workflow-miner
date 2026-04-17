# Workflow Miner

**The observability layer for AI automation, as a local-first macOS app.** Workflow Miner watches how you already work across Gmail, Slack, Linear, Google Calendar, GitHub, Notion, Jira, and Outlook — then surfaces the workflow patterns your team actually repeats, scored by confidence and frequency, and exports each pattern to the runtime of your choice: **Claude, n8n, Zapier, or generic JSON**.

**Your data never leaves your Mac.** The brain database is an embedded Postgres (PGlite) file in `~/Library/Application Support/WorkflowMiner/brain`. OAuth refresh tokens live in the macOS Keychain. The bundled Next.js server binds to `127.0.0.1:<random port>` and is not reachable on the local network. There is no cloud component to trust.

For shell internals, signing, notarization, and troubleshooting see [`apps/desktop/README.md`](apps/desktop/README.md).

## Architecture

```
workflow-miner-monorepo/
├── apps/
│   ├── web/                  # Next.js 15 dashboard + API (runs as Tauri sidecar)
│   │   ├── src/
│   │   │   ├── app/          # Pages & API routes
│   │   │   ├── components/   # React components (shadcn/ui)
│   │   │   └── lib/          # Local-shim (PGlite), desktop bridge, utilities
│   │   └── e2e/              # Playwright E2E tests
│   └── desktop/              # macOS Tauri shell (wraps apps/web locally)
│       ├── src-tauri/        # Rust shell, Keychain, OAuth loopback
│       ├── scripts/          # Next.js sidecar bootstrap + build helpers
│       └── resources/        # Splash + bundled standalone Next.js output
└── packages/
    └── engine/               # @workflow-miner/engine
        └── src/
            ├── connectors/   # Gmail, Slack, Linear, Calendar APIs
            ├── mining/       # PrefixSpan pattern detection
            ├── normalize/    # Raw events → standard schema
            ├── brain/        # Local Postgres persistence layer
            ├── pipeline/     # Ingestion orchestration
            ├── compiler/     # Pattern → Claude skill pack
            └── cli/          # CLI commands
```

### How the app is wired

The desktop app reuses the entire Next.js dashboard. The Tauri shell sets `WORKFLOW_MINER_MODE=desktop` when spawning the Next.js sidecar, and the app rewires itself around a local PGlite database:

- **`apps/web/src/lib/supabase/local-shim.ts`** — a PGlite-backed shim that implements the small subset of the Supabase JS client (`from`, `select`, `eq`, `in`, `or`, `gte`, `lt`, `order`, `limit`, `single`, `insert`, `upsert`, `auth.getUser`) that the codebase actually calls. The existing `schema.sql` runs verbatim because PGlite is real WASM Postgres.
- **`apps/web/src/lib/supabase/{server,admin}.ts`** — factories that return the local shim in desktop mode.
- **`apps/web/src/middleware.ts`** — skips auth in desktop mode (single local user).
- **`apps/web/src/lib/local-brain-client.ts`** — drop-in replacement for the engine's `BrainClient`, used by the sync route.
- **`apps/web/src/lib/desktop-bridge.ts`** — renderer-side bridge into the Tauri shell for Keychain access and OAuth loopback flows.
- **`apps/desktop/src-tauri/`** — Rust shell that picks a free 127.0.0.1 port, spawns the Next.js sidecar, hosts macOS Keychain commands, and runs the OAuth loopback listener.

### Data Flow

```
1. SYNC     Connectors pull raw events from Gmail/Slack/Linear/Calendar
               ↓
2. NORMALIZE Events converted to standard schema (EventType, EntityType)
               ↓
3. INGEST   Normalized events written to brain_timeline (local PGlite)
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
| Backend | Next.js API routes running as a Tauri sidecar |
| Brain DB | PGlite (embedded Postgres, WASM) |
| Engine | TypeScript, PrefixSpan algorithm, Zod validation |
| LLM | OpenRouter (Claude) for chat coaching and nudges |
| Shell | Tauri 2 (Rust) — macOS window, Keychain, OAuth loopback |
| Testing | Playwright (E2E), Vitest (engine unit tests) |
| Deploy | macOS .app (Tauri) |

## Getting Started

Local-first. Runs only on your Mac, no hosted accounts, no cloud database.

### Prerequisites

- macOS (Apple Silicon or Intel)
- Node.js >= 20.0.0
- pnpm >= 8
- Rust toolchain (`rustup`)
- Google Cloud Console project (for Gmail + Calendar OAuth)
- [OpenRouter](https://openrouter.ai) API key (for LLM features)

### 1. Clone and Install

```bash
brew install pnpm rustup
rustup-init -y
rustup target add aarch64-apple-darwin x86_64-apple-darwin

git clone <repo-url>
cd workflow-miner
pnpm install
```

### 2. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth client of type **Desktop application**
3. Enable **Gmail API** and **Google Calendar API** on the project
4. Copy the Client ID and Client Secret into your env file:

```bash
cp apps/desktop/.env.example apps/desktop/.env.local
$EDITOR apps/desktop/.env.local
```

**`apps/desktop/.env.local`** (required for Google connectors):

```env
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-...
NEXT_PUBLIC_GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com

# OpenRouter (for chat coach + nudges + digest summaries)
OPEN_ROUTER_API_KEY=sk-or-v1-...
```

See [`apps/desktop/.env.example`](apps/desktop/.env.example) for the full list of optional variables (data directory override, standalone desktop-mode testing).

### 3. Run the app

```bash
pnpm desktop:dev
```

The Tauri shell launches a native window, spawns the Next.js sidecar on a random localhost port, and opens the dashboard. The brain database is created on first launch at `~/Library/Application Support/WorkflowMiner/brain`.

See [`apps/desktop/README.md`](apps/desktop/README.md) for the full shell architecture, signing/notarization steps, and troubleshooting.

## Usage

### Connecting Sources

1. Navigate to **Connectors** in the app
2. Click **Connect with Google** to authorize Gmail + Calendar via the OAuth loopback flow — tokens land in the macOS Keychain
3. For Slack and Linear, paste API tokens in the settings UI
4. Click **Sync Now** to pull events from connected sources

### Viewing Patterns

After syncing data:

1. Go to **Patterns** to see detected workflow patterns
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

Navigate to **Skills** to export detected patterns as Claude skill packs that can be deployed to automate recurring workflows.

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
| `GET` | `/api/connectors/google/callback` | OAuth callback (stores tokens in Keychain) |
| `POST` | `/api/sync` | Sync all connected sources |

### AI APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | LLM coaching chat (OpenRouter) |
| `GET` | `/api/coach` | AI coaching nudges |

### Admin APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/setup-brain` | Initialize brain database tables (runs automatically on first launch) |
| `POST` | `/api/admin/seed-brain` | Populate demo data (development only) |
| `GET` | `/api/digest` | Generate weekly digest |

## Testing

### E2E Tests (Playwright)

```bash
cd apps/web

# Run all E2E tests
npx playwright test

# Run with UI
npx playwright test --ui

# Run specific test file
npx playwright test e2e/dashboard.spec.ts
```

### Engine Unit Tests (Vitest)

```bash
cd packages/engine
npm test
```

## Building a release

Produce a signed, notarization-ready universal `.app`:

```bash
pnpm desktop:build:universal
```

Output lands in `apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/`. See [`apps/desktop/README.md`](apps/desktop/README.md) for signing and notarization details.

## Project Structure Details

### Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with hero, features, pattern demo |
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
| `brain/` | Local Postgres persistence (timeline + pages) |
| `pipeline/` | Orchestrate ingest flow (connect → normalize → write) |
| `compiler/` | Generate Claude skill packs from patterns |
| `cli/` | Command-line interface for standalone usage |

## License

Private - All rights reserved.
