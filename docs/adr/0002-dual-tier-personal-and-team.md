# 0002 — Dual-tier product: Personal (Mac app) + Team (cloud)

- **Date:** 2026-04-29
- **Status:** Accepted

## Context

After ADR 0001 (single-tenant cloud for Team), we asked: is the cloud the *only* product, or do we also ship a Personal tier?

Forces:

- **Trust spectrum:** even self-hosted Supabase requires the user to trust four vendors (Supabase, Vercel, OpenAI, Inngest) sitting in their own accounts. For *one person* using the product, local-first PGlite is strictly better — verifiable in Activity Monitor that nothing leaves the device.
- **Existing asset:** v0.1.0-alpha.1 of the macOS app shipped 2026-04-28. The codebase, the signing pipeline, and the Tauri shell are already built. Throwing them away is wasteful.
- **Audience overlap:** founders / solo operators want the personal version. Companies want the team version. They're often the same people at different career stages.
- **Maintenance cost:** maintaining two separate codebases forks effort. Maintaining one codebase that ships in two modes is cheaper if the mode-switch is clean.

## Decision

Ship **two tiers from one codebase**. The mode is selected at runtime:

- Server-side: `process.env.WORKFLOW_MINER_MODE === 'desktop'`. Tauri sets this when spawning the Next.js sidecar.
- Browser-side: `window.__TAURI__` truthy check at runtime.

The four Supabase factories in `apps/web/src/lib/supabase/` (`server.ts`, `client.ts`, `admin.ts`, `middleware.ts`) all branch on this. Desktop mode → PGlite shim (`local-shim.ts`). Cloud mode → real `@supabase/ssr` clients.

| | Personal | Team |
|---|---|---|
| DB | PGlite on disk | Supabase Postgres |
| Auth | macOS Keychain (single local user) | Supabase Auth (magic link + Google) |
| Distribution | Signed `.app` from GitHub Releases | Vercel + Supabase deploy per customer |
| Trust ask | None — verifiable | Trust your own Supabase + Vercel |

## Consequences

- **Pro:** Two distinct trust pitches — Personal can honestly say "your data never leaves your Mac"; Team says "your data never leaves your Supabase project."
- **Pro:** One codebase. Most of the engine (connectors, normalizer, mining, compiler) is identical between tiers.
- **Pro:** Upgrade path — solo users on Personal can upgrade to Team for their company without changing tools.
- **Pro:** Free distribution channel — the signed `.app` gets us on Hacker News, Product Hunt, the gbrain-compatible-with-Garry-Tan narrative.
- **Con:** Some features (`/brain` agent, `/api/mcp/*`) use `.rpc("match_*")` which the PGlite shim doesn't implement. Personal tier loses access to those routes until the shim is extended.
- **Con:** Type system has to bridge two clients. We cast `LocalShimClient as unknown as SsrClient` — works at runtime because of structural overlap, but TypeScript can't verify it.
- **Con:** Test surface doubles — every code path needs to be considered in both modes (we don't currently test both modes, only cloud).

## Alternatives considered

- **Cloud only** (V4-V6): trades the personal-tier trust pitch for simplicity. Rejected because the user explicitly pushed back: *"I thought we are building a macos app as how the user will trust that their data leave?"*
- **Desktop only** (V0): doesn't scale to teams. Rejected because the YC RFS category is "Company Brain," which requires multi-user.
- **Two separate codebases**: cleanest separation but doubles maintenance. Rejected because the mode-switch is a one-line check and the rest of the code is genuinely shared.
- **Local-only + manual sync to teammates' machines**: like `git push` for brains. Interesting but huge product complexity. Defer.

## Open follow-ups

- Implement `.rpc()` in `local-shim.ts` so the brain agent + MCP routes work in desktop mode.
- Add CI step that builds the desktop tier (`pnpm desktop:build`) on macOS runners.
- Explore Windows + Linux Tauri builds for the Personal tier.
