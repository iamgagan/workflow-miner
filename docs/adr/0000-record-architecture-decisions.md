# 0000 — Record architecture decisions

- **Date:** 2026-04-29
- **Status:** Accepted

## Context

This codebase has churned through several major architectural shifts in a short window: local-first macOS app → multi-tenant SaaS attempt → single-tenant per-deployment cloud → dual-tier Personal + Team. Without a record, every new contributor (human or AI agent) re-litigates settled questions. We lost time more than once relitigating the trust model.

## Decision

Use lightweight Architecture Decision Records (ADRs), inspired by Michael Nygard's [original format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). Each ADR is a single Markdown file under `docs/adr/`, numbered, dated, and immutable once accepted.

Format:

```markdown
# NNNN — Short title

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Superseded by NNNN | Deprecated
- **Supersedes:** NNNN (if applicable)

## Context
What problem are we solving? What forces are at play?

## Decision
What we chose. Be specific.

## Consequences
What this enables, what it constrains, what it costs.

## Alternatives considered
Other paths and why we didn't take them.
```

When superseding an ADR, add a new ADR that says "Supersedes 00XX" and update the old one's status. Don't edit the old one's body.

## Consequences

- **Pro:** A new contributor can read the ADRs in order and reconstruct the rationale for the current architecture.
- **Pro:** Forces us to write down decisions instead of letting them live only in someone's head or a Slack DM.
- **Con:** Slight upfront cost on every architectural decision (write the ADR).
- **Con:** ADRs go stale if not maintained — we accept this cost.

## Alternatives considered

- **Confluence / Notion** — out-of-repo, harder to keep in sync with the code, harder to grep, harder for AI agents to find.
- **No record** — the V0→V7 churn is exactly what happens.
- **Inline code comments** — works for "why this branch" but not for "why this whole architecture."
