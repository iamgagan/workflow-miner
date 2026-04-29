# AGENTS.md — Context for AI coding assistants

Read this before touching anything. It's the orientation page for Claude Code, Codex CLI, Cursor, Aider, Cline, and any future MCP-aware editor working in this repo.

## What this repo is

Workflow Miner is a **dual-tier company brain** that ingests work events from SaaS tools (Gmail, Slack, Linear, Calendar, GitHub, Notion, Jira, Outlook), embeds them into a vector store, mines workflow patterns, and exposes the result as a chat agent + MCP server + automation runtime.

Two tiers, **same codebase**:

- **Personal** (`apps/desktop/`): macOS Tauri shell, PGlite on disk, single user, "data never leaves your Mac"
- **Team** (`apps/web/` deployed to Vercel + Supabase): cloud, multi-user, self-hosted on the customer's own infrastructure

The mode switch is `WORKFLOW_MINER_MODE=desktop` env var (server-side) or `window.__TAURI__` runtime check (browser-side). All four Supabase factories in `apps/web/src/lib/supabase/` branch on this — desktop returns the PGlite shim (`local-shim.ts`); cloud returns real `@supabase/ssr` clients.

## File map

```
apps/
  web/                          ← Next.js 15 + React 19 app, drives BOTH tiers
    src/
      app/
        (dashboard)/            ← /dashboard, /connectors, /patterns, /skills, /settings
        brain/                  ← /brain chat UI (cloud only — uses .rpc which PGlite shim lacks)
        login/                  ← magic-link + Google OAuth signin (cloud only)
        invite/, auth/callback  ← cloud only
        api/
          brain/agent/          ← streaming gpt-4o agent with 3 tools (cloud only)
          inngest/              ← Inngest webhook
          mcp/{search,page,activity,patterns,trigger}/  ← bearer-token MCP HTTP API (cloud only)
          keys/                 ← API key CRUD
          dream/run, export/run ← manual triggers for Inngest functions
          health                ← public health endpoint
          connectors/           ← OAuth flows (works in both tiers, via desktop-bridge)
          sync                  ← dispatches sync jobs to Inngest
      lib/
        supabase/{server,client,admin,middleware,local-shim}.ts  ← THE dual-mode boundary
        desktop-bridge.ts       ← Tauri invoke + Keychain + OAuth loopback (no-op in cloud)
        local-brain-client.ts   ← engine ↔ PGlite bridge (desktop only)
        mcp-auth.ts, cors.ts    ← cloud helpers
      inngest/
        client.ts, functions.ts ← syncCompanyData, executePattern, dreamCycle, exportToGit
  desktop/                      ← Tauri shell, frozen-but-active. v0.1.0-alpha.1 binary shipped 2026-04-28
    src-tauri/                  ← Rust shell, Keychain commands, OAuth loopback
packages/
  engine/                       ← @workflow-miner/engine: connectors, mining, normalize, brain schema, compiler
    src/brain/schema.sql        ← THE schema. Apply to Supabase via SQL editor. Idempotent (CREATE IF NOT EXISTS).
  mcp-server/                   ← @workflow-miner/mcp npm package — stdio MCP server, 5 tools
docs/
  superpowers/specs/            ← brainstorming output (design docs)
  superpowers/plans/            ← implementation plans
  adr/                          ← architecture decision records
  DEPLOY.md, DEMO.md            ← deploy guide, demo recording script
```

## Things to avoid (will burn your session)

1. **Don't modify `apps/web/src/lib/supabase/local-shim.ts` without understanding the dual-mode contract.** It's 774 lines that implement the subset of the Supabase JS client the codebase actually uses. Adding `.rpc()` to it would unlock the `/brain` agent in desktop mode (currently cloud-only) — that's a real fix, just understand the scope.

2. **Don't add a third-party SaaS dependency to the Personal tier.** The trust pitch is "no network for the brain itself; OpenAI calls only when you ask the chat agent." Adding Sentry / PostHog / etc. to the Tauri sidecar breaks that guarantee.

3. **Don't `console.log` Authorization headers or `wmk_*` raw API keys.** They're sensitive. The `mcp-auth` middleware fire-and-forgets `last_used_at` updates instead of logging.

4. **Don't remove `local-shim.test.ts` from the vitest exclude list.** It uses `node:test` (run via `node --experimental-strip-types --test`), not vitest. Trying to unify them is a rabbit hole.

5. **Don't merge to `main` without `pnpm --filter web build` passing.** CI runs on every push and PR — don't push broken builds, even to feature branches.

## Things to look at first when debugging

- **Build broken after dep change?** `pnpm install` first, then check `apps/web/package.json` for the new dep, then check if it has peer-dep warnings (we ignore opentelemetry warnings; everything else should be addressed).
- **Tests broken?** `pnpm --filter web test`. The 21 vitest tests cover dream-cycle entity extraction, markdown rendering, and mcp-auth hashing. If you broke these, you broke real behavior.
- **Cloud route returns 401?** Check `apps/web/src/lib/supabase/middleware.ts` — public routes are listed in `isPublicRoute`. New API routes are public-by-the-`/api`-prefix.
- **Brain agent crashes?** It calls `supabase.rpc("match_timeline_entries", ...)`. The RPC exists in `packages/engine/src/brain/schema.sql` — confirm the migration has been applied to your Supabase project.
- **Desktop app won't launch?** Check `apps/desktop/src-tauri/tauri.conf.json` for the `beforeBuildCommand` path; it's a known historical pain point (commits `da1e4b1` + `35e7af0`).

## Project conventions

- **Conventional commits** with scope: `feat(dream): ...`, `fix(mcp): ...`, `chore(deps): ...`. See `CONTRIBUTING.md` for full scope list.
- **No comments** unless the why is non-obvious. No "this function does X" comments.
- **Types via Zod** at API boundaries, plain TS interfaces inside.
- **Imports:** absolute via `@/` for app code; relative for sibling files.
- **No emojis in code or commits** unless the user explicitly asks.
- **No backward-compat shims for deleted code.** Just delete.

## When you're not sure

- Check `docs/adr/` — architecture decisions are recorded with rationale.
- Check `docs/superpowers/specs/` and `docs/superpowers/plans/` — past designs.
- Read the specific commit that introduced the area you're touching (`git log -p --follow <file>`).

## Project history (TL;DR)

- **V0** (`b1b757b`, 2026-04-28): Local-first macOS app shipped as v0.1.0-alpha.1.
- **V1-V3** (`94a2eac`): Antigravity (an external coding agent) attempted multi-tenant SaaS pivot. Partial; broke build.
- **V4** (`15a3e5c`): Reverted to single-tenant per-deployment cloud (one Supabase project per company).
- **V5** (`c801093`): gbrain alignment shipped — Dream Cycles, MCP server, Markdown export.
- **V6** (`ae07786`): Production-readiness — CI, /api/health, CORS on MCP routes, deploy guide.
- **V7** (`eec7e6b`): UNFROZE the Mac app — dual-tier from one codebase.

Each major shift has an ADR. Read them.

## License + ethics

AGPL-3.0-or-later. Anything you derive must stay open. Don't help anyone close this code or build a hosted SaaS on top without source disclosure.
