# Security Policy

Workflow Miner handles email, Slack, calendar, and ticket data — high-sensitivity material. We take security seriously and welcome reports.

## Reporting a vulnerability

**Please do not file public GitHub issues for security problems.**

Email **gagan.2492@gmail.com** with:

- A clear description of the issue
- Steps to reproduce (or a proof-of-concept if relevant)
- The version / commit you reproduced it on (`git rev-parse HEAD`)
- Whether the issue affects the **Personal tier** (macOS app) or **Team tier** (cloud deployment) or both
- Your name / handle if you'd like credit in the fix's changelog

We will acknowledge within **3 business days** and aim to ship a fix within **14 days** for high-severity issues.

## Scope

In scope:

- The codebase in this repository — `apps/web/`, `apps/desktop/`, `packages/engine/`, `packages/mcp-server/`
- The `@workflow-miner/mcp` npm package
- The `schema.sql` migration

Out of scope (report directly to the respective vendors):

- Supabase, Vercel, Inngest, OpenAI vulnerabilities
- macOS / Tauri / pgvector vulnerabilities
- Self-hosted misconfigurations (e.g. user committed their `.env.local` to a public repo)

## Threat model assumptions

- **Personal tier:** runs on a single user's Mac. Threat model = local malware / physical access. We rely on the macOS Keychain for OAuth refresh tokens and PGlite for at-rest storage. No network listener except 127.0.0.1.
- **Team tier:** runs on the customer's own Vercel + Supabase project. Threat model = web app attack surface (XSS, CSRF, SQL injection, auth bypass), Supabase RLS bypass, leaked API keys. Tenant isolation is one Supabase project per company; we do not run a shared multi-tenant SaaS.

## Hall of fame

Reporters who responsibly disclose will be credited here once their fix ships (with permission).
