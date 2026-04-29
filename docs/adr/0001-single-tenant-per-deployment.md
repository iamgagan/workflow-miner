# 0001 — Single-tenant per Supabase deployment for the cloud Team tier

- **Date:** 2026-04-29
- **Status:** Accepted

## Context

After Antigravity (an external coding agent) made an unprompted multi-tenant SaaS refactor (commits `94a2eac` and predecessors), we asked: should the cloud product be (A) multi-tenant — Workflow Miner Inc. runs one Supabase project that all customers share, RLS-isolated by `organization_id`, or (B) single-tenant — each customer creates their own Supabase project, no shared infra?

Forces:

- **Trust:** The product handles email, Slack, Linear data — high-sensitivity. A shared SaaS (A) means customers trust us with their raw data. Single-tenant (B) means data sits in their own AWS-hosted Supabase account.
- **Compliance:** Some customers (legal, healthcare, finance) cannot send raw work data to a shared multi-tenant cloud they don't control.
- **Build complexity:** (A) requires `organization_id` columns on every table, RLS policies keyed off JWT claims, an org-membership table, invite flows, signup hooks. (B) is just regular Postgres + auth.
- **Operating burden:** (A) means we operate Supabase + customer support. (B) shifts ops to the customer.
- **Sales motion:** (A) = product-led growth, sign up + immediately use. (B) = ~30-min self-serve install, harder onboarding.

## Decision

**Single-tenant per Supabase deployment.** Each company creates their own Supabase project, runs `schema.sql`, deploys the Next.js app to their own Vercel. Their data sits in their own infrastructure. We never see it.

Multi-tenancy is achieved by *isolation of deployments*, not by row-level tenant filtering. RLS is simple: any `authenticated` user has full access. Supabase's allowed-email-domains setting gates who can sign up.

## Consequences

- **Pro:** Honest data-sovereignty pitch — "your data sits in your own Supabase, never on our servers." Verifiable.
- **Pro:** Compliance surface narrows to "is Supabase + Vercel acceptable in your stack?" — usually yes for AWS-friendly orgs.
- **Pro:** Codebase is ~30% smaller without `organization_id`, RLS predicates, org_members, org_invites, accept-invite flow, signup trigger.
- **Pro:** Each customer can pick their Supabase region for data residency.
- **Con:** No product-led growth. Each customer needs ~30 min to install (see `docs/DEPLOY.md`).
- **Con:** We can't easily ship hot-fixes to all customers — they have to redeploy from `main`.
- **Con:** No telemetry / aggregate usage data — we don't see what customers do.

## Alternatives considered

- **Multi-tenant SaaS (A)** — implemented in commits `94a2eac` and reverted in `15a3e5c`. The build worked but the trust story was weak. Could revive later as an alternative tier if we get strong demand for hosted-by-us, but not the lead product.
- **Self-hosted Postgres + docker-compose (no Supabase)** — strictly more sovereignty than per-Supabase, but the deployment story gets harder (customers manage Postgres themselves). Worth revisiting if a customer demands no-third-party-DB.
