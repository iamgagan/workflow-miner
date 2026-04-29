# Contributing to Workflow Miner

Workflow Miner is **AGPL-3.0-or-later**. Contributions are welcome from anyone running their own Personal-tier Mac app or Team-tier cloud deployment. By submitting a PR, you agree your contribution is licensed under AGPL-3.0-or-later.

## Repo layout

- `apps/web/` — Next.js 15 app. Drives both tiers (mode flips on `WORKFLOW_MINER_MODE=desktop` env var, server-side; `window.__TAURI__`, browser-side).
- `apps/desktop/` — Tauri 2 macOS shell. Spawns the Next.js sidecar locally on `127.0.0.1:<random>`.
- `packages/engine/` — TypeScript engine: connectors, mining (PrefixSpan), normalizer, brain schema, compiler.
- `packages/mcp-server/` — Standalone npm package `@workflow-miner/mcp` — stdio MCP server for editor integration.
- `docs/` — Specs, plans, ADRs, deploy + demo guides.

## Local setup

```bash
git clone https://github.com/iamgagan/workflow-miner
cd workflow-miner
pnpm install

# Cloud-mode dev (no Tauri needed):
pnpm --filter web dev

# Desktop-mode dev (Tauri shell + PGlite + sidecar):
pnpm desktop:dev

# Tests:
pnpm --filter web test                       # vitest unit
pnpm --filter @workflow-miner/engine test    # vitest engine
pnpm --filter web build                      # full Next.js build
```

You'll need:

- Node 20+ (`nvm use` if you have nvm)
- pnpm 9+
- For desktop: Rust toolchain (`rustup`), Xcode CLT

## Two-tier wiring (read this before touching `apps/web/src/lib/supabase/`)

The Supabase factories (`server.ts`, `client.ts`, `admin.ts`, `middleware.ts`) **all branch on tier**. Server-side checks `process.env.WORKFLOW_MINER_MODE === 'desktop'`; browser-side checks `window.__TAURI__`. In desktop mode they return the PGlite shim (`local-shim.ts`). In cloud mode they return the real `@supabase/ssr` clients.

When adding a new `.from('table')` or `.rpc('function')` call: verify the PGlite shim implements that method, or your code will only work in cloud mode. Currently the shim does NOT implement `.rpc()`, which is why the new `/brain` agent + `/api/mcp/*` routes are cloud-only.

## What to PR

**Welcome:**

- Bug fixes (Personal or Team tier)
- New connectors in `packages/engine/src/connectors/` (follow the `Connector` interface)
- Tests for existing code (we have 21; we should have more)
- Docs improvements
- Performance fixes
- New runtime adapters for `executePattern` (`pattern-executor` runtime — see `apps/web/src/inngest/functions.ts` TODO)
- Cross-platform support for the Personal tier (Tauri can build Windows + Linux; we currently only target macOS)

**Open an issue first before:**

- Schema changes — coordinate with the deploy story
- New top-level features — small spec via the brainstorming pattern keeps everyone aligned
- Adding a third tier — there are good reasons to keep the Personal/Team split clean

**We won't merge:**

- Hardcoded secrets / API keys
- Code that introduces a third-party SaaS dependency on the Personal tier (breaks the trust pitch)
- Closed-source binaries or non-AGPL-compatible deps

## Commit format

Conventional commits with scope:

```
feat(dream): support custom enrichment prompts via env var
fix(mcp): handle malformed bearer tokens cleanly
docs(deploy): add note about Inngest cloud webhook URL
test(engine): add coverage for the Slack connector pagination edge case
chore(deps): bump @octokit/rest to 22.1
```

Scopes we use: `web`, `engine`, `desktop`, `mcp`, `dream`, `export`, `schema`, `deploy`, `docs`, `test`, `ci`, `chore`.

## Pull requests

- One logical change per PR. Easier to review, easier to revert.
- Tests required for new code paths if there's an existing test pattern. If you're touching code without tests, adding one earns extra credit but isn't required.
- Build must be green (`pnpm --filter web build`) and tests must pass (`pnpm --filter web test`). CI enforces this.
- Update `docs/` if your change affects deploy, env vars, or user-facing behavior.
- Add an ADR in `docs/adr/` if you're making a non-obvious architectural choice (see [`docs/adr/0000-record-architecture-decisions.md`](docs/adr/0000-record-architecture-decisions.md)).

## Code of conduct

Be kind. Assume good faith. If you wouldn't say it to a teammate, don't say it on a PR.

## Questions

Open a GitHub Discussion or ping `@iamgagan` on X. For security issues see [`SECURITY.md`](SECURITY.md).
