# 0004 — Ratcheted code health gate + dual AI guidance shim

- **Date:** 2026-04-29
- **Status:** Accepted

## Context

Two operational gaps surfaced when comparing this repo to [Tolaria](https://github.com/refactoringhq/tolaria), an AGPL desktop knowledge tool that operates on the same vault format we export to (see ADR 0003):

1. **No write-time quality gate.** `pnpm lint`, `tsc --noEmit`, and `vitest run` only run when CI runs — which means broken commits land on feature branches, broken pushes trigger remote runners, and code health drifts gradually with no signal until someone notices a Big File. Tolaria addresses this with husky pre-commit + pre-push hooks that mirror CI locally, plus a CodeScene Code Health ratchet (their ADR 0064) that prevents regressions.
2. **No `CLAUDE.md` at repo root.** We have `AGENTS.md` (the open standard adopted by Codex CLI, Cursor, Aider, Cline). Claude Code defaults to looking for `CLAUDE.md` first, then falls back. Without a `CLAUDE.md` shim, every Claude Code session in this repo starts without our orientation doc until the user manually points at `AGENTS.md`. Tolaria solved this with a one-line `CLAUDE.md` that re-exports `AGENTS.md` (their ADR 0065).

These are independent decisions but they share a cause — borrow Tolaria's operational hygiene where it cleanly applies — so they share an ADR.

## Decision

### 1. Husky pre-commit + pre-push

- `prepare` script in root `package.json` runs `husky` on `pnpm install`, auto-installing hooks for every contributor.
- **`.husky/pre-commit`** (fast, <30s): if any `.ts`/`.tsx` is staged, run `tsc --noEmit` on the workspaces that have staged changes. Skip otherwise. Lint is intentionally deferred — `next lint` is deprecated in Next 15 and prompts interactively; we'll re-enable in this hook once we migrate to the ESLint CLI.
- **`.husky/pre-push`** (CI-equivalent, ~1–2 min): build engine, build web (with the same stub env vars CI uses), run `vitest`. This catches every class of failure CI catches, before the push leaves the laptop.
- Both hooks ensure pnpm + node are on PATH (so launching from a GUI git client doesn't fail silently).
- Neither hook enforces "must be on main" — we use feature branches → PR → main. (Tolaria pushes directly to main; that's their workflow choice, not ours.)

### 2. Ratcheted CodeScene Code Health gate (scaffolding now, runtime later)

- `.codescene-thresholds` holds two numbers: `HOTSPOT_THRESHOLD` and `AVERAGE_THRESHOLD`. Initially zeros (no-op until first analysis lands).
- The ratchet rule: thresholds only ever go **up**. When CodeScene reports a higher score, the pre-push hook (once wired) updates the file with `floor(now * 100) / 100` and asks the developer to commit the new floor.
- `.codescenerc` + `.codesceneignore` exclude generated, vendored, and tooling code (would otherwise hotspot-noise the report).
- The husky hook does NOT call CodeScene yet. We add the config files now so wiring the runtime is one PR, not two; until then `CODESCENE_PAT` is unset and there is zero runtime cost.

### 3. `CLAUDE.md` re-export shim

- New `CLAUDE.md` at repo root contains `@AGENTS.md` and a one-line note. Claude Code reads it first; the `@` import pulls in the AGENTS.md body.
- **`AGENTS.md` remains the source of truth.** Never duplicate content between the two files.

## Consequences

- **Pro:** Bad commits get blocked at write time. Half the failures we'd debug from CI logs never reach CI.
- **Pro:** `pnpm install` is a one-time setup step — every contributor gets the same gate.
- **Pro:** When we sign up for CodeScene, the threshold file + ignore rules are already in place; activation is one hook block.
- **Pro:** Claude Code sessions start with full repo orientation, same as Codex CLI / Cursor / Aider sessions already do.
- **Con:** Pre-push adds ~1–2 minutes to every push. Acceptable for trunk hygiene; bypassable with `HUSKY=0` for emergencies.
- **Con:** Two AI guidance files to keep in sync — mitigated by `CLAUDE.md` being a single-line re-export. If anyone edits its body, that's the bug.
- **Con:** `.codescene-thresholds` exists but does nothing until we activate. Mild signal-to-noise cost; acceptable given the future-PR savings.

## Alternatives considered

- **Just CI, no local hooks.** Status quo. Means every "did I break the build?" question costs a CI runner minute and a context switch. Rejected.
- **Lint-staged + lefthook instead of husky.** Smaller runtimes, but husky is the broadest convention and Tolaria's exact tooling — borrowing the same tool means borrowing the same shape, fewer surprises.
- **Activate CodeScene now.** Requires an account and a repo connection; we don't have that yet. Adding the runtime check before the account exists would mean a hook that always logs "skipping" — pure noise.
- **Duplicate `AGENTS.md` into `CLAUDE.md`.** Two sources of truth always drift. Rejected.
- **Move everything to `CLAUDE.md` and shim `AGENTS.md`.** Reverses which standard we treat as canonical. AGENTS.md is the open multi-vendor standard; we keep it canonical.
