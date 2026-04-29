# gbrain Alignment Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Dream Cycles, MCP server, and Markdown export to position Workflow Miner as the company-version of Garry Tan's gbrain.

**Architecture:** Three additive features sharing existing infrastructure (Supabase + Inngest + Next.js). Schema gets one new column, one new index, one new table. App gets two new Inngest functions (`dreamCycle`, `exportToGit`), nine new API routes, one shared lib (`mcp-auth`), one settings page, and one new workspace package (`@workflow-miner/mcp`).

**Tech Stack:** TypeScript, Next.js 15, Supabase (Postgres + pgvector), Inngest v4, OpenAI (`gpt-4o-mini` for enrichment, `text-embedding-3-small` for embeddings), `@octokit/rest`, `@modelcontextprotocol/sdk`, Vitest (added in Task A2).

**Source spec:** [`docs/superpowers/specs/2026-04-29-gbrain-alignment-features-design.md`](../specs/2026-04-29-gbrain-alignment-features-design.md)

**Repo state:** Branch `workflow-miner`, base commit `522568d` (single-tenant per-deployment, build green).

---

## File map

### New files (15)
| Phase | Path | Responsibility |
|---|---|---|
| A | `apps/web/vitest.config.ts` | Vitest configuration |
| A | `apps/web/src/inngest/__tests__/setup.ts` | Test setup (env stubs, mocks) |
| B | `apps/web/src/app/api/dream/run/route.ts` | Manual trigger for `dreamCycle` |
| C | `apps/web/src/app/api/export/run/route.ts` | Manual trigger for `exportToGit` |
| C | `apps/web/src/inngest/markdown.ts` | Pure function: page → markdown |
| C | `apps/web/src/inngest/__tests__/markdown.test.ts` | Tests for the renderer |
| D | `apps/web/src/lib/mcp-auth.ts` | Bearer-token auth middleware |
| D | `apps/web/src/lib/__tests__/mcp-auth.test.ts` | Tests for auth |
| D | `apps/web/src/app/api/keys/route.ts` | Create + list API keys |
| D | `apps/web/src/app/api/keys/[id]/route.ts` | Revoke an API key |
| D | `apps/web/src/app/api/mcp/search/route.ts` | Vector search |
| D | `apps/web/src/app/api/mcp/page/[slug]/route.ts` | Fetch a brain page |
| D | `apps/web/src/app/api/mcp/activity/route.ts` | Recent timeline |
| D | `apps/web/src/app/api/mcp/patterns/route.ts` | List patterns |
| D | `apps/web/src/app/api/mcp/trigger/route.ts` | Dispatch workflow execution |
| E | `packages/mcp-server/package.json` | New workspace package |
| E | `packages/mcp-server/tsconfig.json` | TS config |
| E | `packages/mcp-server/src/index.ts` | Stdio MCP server |
| E | `packages/mcp-server/bin/wm-mcp.js` | Bin entry point |
| E | `packages/mcp-server/README.md` | Install + usage docs |
| F | `apps/web/src/app/(dashboard)/settings/api-keys/page.tsx` | Settings UI |

### Modified files (5)
| Phase | Path | Change |
|---|---|---|
| A | `packages/engine/src/brain/schema.sql` | Add column + index + `api_keys` table + RLS |
| A | `apps/web/package.json` | Add `vitest`, `@octokit/rest`, `vitest` test scripts |
| A | `pnpm-workspace.yaml` | Add `packages/mcp-server` (Phase E uses it) |
| A | `.env.example` | Add `DREAM_CYCLE_*`, `OPENAI_MODEL_ENRICH`, `GITHUB_EXPORT_*` |
| B/C | `apps/web/src/inngest/functions.ts` | Add `dreamCycle` + `exportToGit` exports |
| B/C | `apps/web/src/app/api/inngest/route.ts` | Register both new functions |

---

## Phase A — Foundation

### Task A1: Schema additions

**Files:**
- Modify: `packages/engine/src/brain/schema.sql` (append after the existing RPC functions, before EOF)

- [ ] **Step 1: Append schema additions**

Append the following to `packages/engine/src/brain/schema.sql`:

```sql
-- ─── gbrain-alignment additions (2026-04-29) ──────────────────────────────

-- Dream Cycles: track when each page was last LLM-enriched.
ALTER TABLE brain_pages
  ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMPTZ;

-- Index helps the "find stale pages" query in the dream cycle find work fast.
CREATE INDEX IF NOT EXISTS brain_pages_last_enriched_idx
  ON brain_pages (last_enriched_at NULLS FIRST);

-- MCP server: per-user API keys.
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,        -- SHA-256 of the raw key; raw never persisted
  label TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see their own keys" ON api_keys
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id);
```

- [ ] **Step 2: Verify SQL parses (no DB needed yet)**

Run a syntax check using `pglast` or a quick `psql --dry-run` if available. If neither is on hand, just visually verify that:
1. Every statement ends in `;`.
2. The `api_keys` policy uses `FOR ALL TO authenticated` (not just `FOR SELECT`).
3. The HNSW indexes from earlier in the file are NOT duplicated.

```bash
grep -c "CREATE INDEX" packages/engine/src/brain/schema.sql
```
Expected: 8 (4 existing — 4 brain tables organization indexes are gone in single-tenant; the 2 HNSW + 2 timeline/links + the 2 new + 2 api_keys = 8). Adjust if the existing count differs; the check is "no duplicate index names."

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/brain/schema.sql
git commit -m "feat(schema): add Dream Cycle column + api_keys table for MCP"
```

---

### Task A2: Vitest setup in apps/web

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/inngest/__tests__/setup.ts`

- [ ] **Step 1: Add vitest deps**

```bash
cd apps/web && pnpm add -D vitest @vitest/ui happy-dom
```

- [ ] **Step 2: Add test scripts to apps/web/package.json**

Edit `apps/web/package.json`. In `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 3: Create vitest.config.ts**

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/inngest/__tests__/setup.ts"],
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 4: Create test setup file**

Create `apps/web/src/inngest/__tests__/setup.ts`:

```ts
// Test-time env stubs so lazy clients don't crash if accidentally instantiated.
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-openai-key";
```

- [ ] **Step 5: Smoke test**

Create a throwaway test to verify the setup works.

`apps/web/src/inngest/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:

```bash
cd /Users/gagan/Projects/workflow-miner/workflow-miner && pnpm --filter web test
```

Expected: `1 passed`. Then delete the smoke test file:

```bash
rm apps/web/src/inngest/__tests__/smoke.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts apps/web/src/inngest/__tests__/setup.ts pnpm-lock.yaml
git commit -m "test: set up vitest in apps/web for new gbrain features"
```

---

### Task A3: Env additions and Octokit dep

**Files:**
- Modify: `.env.example`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add Octokit**

```bash
cd apps/web && pnpm add @octokit/rest
```

- [ ] **Step 2: Append env vars to .env.example**

Append to `.env.example` (do not modify existing entries):

```env

# ───────────────────────────────────────────────────────────────────────────
# Dream Cycles (nightly LLM enrichment)
# ───────────────────────────────────────────────────────────────────────────
# Cron in UTC. Default is 3am UTC. Override to your off-hours.
DREAM_CYCLE_CRON=0 3 * * *
# Per-run cap. Pages exceeding this roll over to the next night.
DREAM_CYCLE_MAX_PAGES_PER_RUN=500
# Model used for entity extraction + compiled-truth refresh.
OPENAI_MODEL_ENRICH=gpt-4o-mini

# ───────────────────────────────────────────────────────────────────────────
# Markdown export to GitHub (optional — leave blank to disable)
# ───────────────────────────────────────────────────────────────────────────
# Fine-scoped PAT with repo write access.
GITHUB_EXPORT_PAT=
# owner/repo, e.g. acme/company-brain-mirror
GITHUB_EXPORT_REPO=
GITHUB_EXPORT_BRANCH=main
```

- [ ] **Step 3: Commit**

```bash
git add .env.example apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add @octokit/rest and document Dream Cycle / export env vars"
```

---

## Phase B — Dream Cycles

### Task B1: Manual trigger route + function skeleton

**Files:**
- Create: `apps/web/src/app/api/dream/run/route.ts`
- Modify: `apps/web/src/inngest/functions.ts` (append `dreamCycle` skeleton)
- Modify: `apps/web/src/app/api/inngest/route.ts` (register)

- [ ] **Step 1: Add dreamCycle skeleton to functions.ts**

Append to `apps/web/src/inngest/functions.ts`:

```ts
// Nightly LLM-enrichment pass. Walks every page touched since its last
// enrichment and refreshes its compiled_truth, extracts entities, re-embeds
// if the truth changed. Bounded by DREAM_CYCLE_MAX_PAGES_PER_RUN per run.
export const dreamCycle = inngest.createFunction(
  {
    id: "dream-cycle",
    name: "Dream Cycle (LLM enrichment)",
    triggers: [
      { cron: process.env.DREAM_CYCLE_CRON ?? "0 3 * * *" },
      { event: "dream/cycle.requested" },
    ],
  },
  async ({ step }) => {
    const max = parseInt(process.env.DREAM_CYCLE_MAX_PAGES_PER_RUN ?? "500", 10);

    const stalePages = await step.run("find-stale-pages", async () => {
      const { data, error } = await supa()
        .from("brain_pages")
        .select("id, slug, type, title, compiled_truth, timeline, updated_at, last_enriched_at")
        .or("last_enriched_at.is.null,last_enriched_at.lt.updated_at")
        .order("last_enriched_at", { ascending: true, nullsFirst: true })
        .limit(max);
      if (error) throw new Error(`find-stale-pages failed: ${error.message}`);
      return data ?? [];
    });

    for (const page of stalePages) {
      await step.run(`enrich-page-${page.id}`, async () => {
        // Implemented in Task B2 (compiled-truth refresh) and B3 (entities).
        const { error } = await supa()
          .from("brain_pages")
          .update({ last_enriched_at: new Date().toISOString() })
          .eq("id", page.id);
        if (error) throw new Error(`mark-enriched failed: ${error.message}`);
      });
    }

    await step.sendEvent("notify-export", {
      name: "dream/cycle.completed",
      data: { pagesEnriched: stalePages.length },
    });

    return { pagesEnriched: stalePages.length };
  }
);
```

- [ ] **Step 2: Register dreamCycle in the Inngest serve handler**

Edit `apps/web/src/app/api/inngest/route.ts`:

```ts
import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { syncCompanyData, executePattern, dreamCycle } from "../../../inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncCompanyData,
    executePattern,
    dreamCycle,
  ],
});
```

- [ ] **Step 3: Create the manual trigger route**

Create `apps/web/src/app/api/dream/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

// POST /api/dream/run — manually trigger a Dream Cycle outside of cron.
// Auth required (any signed-in user can fire it; cost is bounded by
// DREAM_CYCLE_MAX_PAGES_PER_RUN).
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { ids } = await inngest.send({
    name: "dream/cycle.requested",
    data: { triggeredBy: user.id, source: "manual" },
  });

  return NextResponse.json({ ok: true, eventId: ids[0] });
}
```

- [ ] **Step 4: Verify build still passes**

```bash
cd /Users/gagan/Projects/workflow-miner/workflow-miner && pnpm --filter web build 2>&1 | grep -E "(error|Error|Failed|✓ Compiled|✓ Generating)" | head -10
```

Expected: `✓ Compiled successfully` and `✓ Generating static pages` lines, no error lines.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/inngest/functions.ts apps/web/src/app/api/inngest/route.ts apps/web/src/app/api/dream/run/route.ts
git commit -m "feat(dream): scaffold dreamCycle Inngest function + manual trigger"
```

---

### Task B2: Implement compiled_truth refresh

**Files:**
- Modify: `apps/web/src/inngest/functions.ts` (replace the placeholder enrich step from B1)

- [ ] **Step 1: Replace the enrich step with the real implementation**

In `apps/web/src/inngest/functions.ts`, find the `for (const page of stalePages)` loop and replace it with:

```ts
for (const page of stalePages) {
  await step.run(`enrich-page-${page.id}`, async () => {
    const newCompiledTruth = await refreshCompiledTruth(page);

    const updates: Record<string, unknown> = {
      last_enriched_at: new Date().toISOString(),
    };

    if (newCompiledTruth && newCompiledTruth !== page.compiled_truth) {
      updates.compiled_truth = newCompiledTruth;
      updates.embedding = await generateEmbedding(`${page.title} ${newCompiledTruth}`);
    }

    const { error } = await supa()
      .from("brain_pages")
      .update(updates)
      .eq("id", page.id);
    if (error) throw new Error(`update-page-${page.id} failed: ${error.message}`);
  });
}
```

- [ ] **Step 2: Add the refreshCompiledTruth helper above the function**

Insert above `export const dreamCycle`:

```ts
const ENRICH_MODEL = process.env.OPENAI_MODEL_ENRICH ?? "gpt-4o-mini";

async function refreshCompiledTruth(page: {
  id: number;
  slug: string;
  title: string;
  compiled_truth: string | null;
  timeline: string | null;
}): Promise<string | null> {
  // Pull the most recent timeline entries to ground the summary.
  const { data: entries } = await supa()
    .from("brain_timeline")
    .select("date, source, summary, detail")
    .eq("page_id", page.id)
    .order("date", { ascending: false })
    .limit(20);

  if (!entries || entries.length === 0) {
    // No new evidence — keep the existing compiled_truth.
    return page.compiled_truth;
  }

  const evidence = entries
    .map((e) => `- ${e.date} (${e.source}) ${e.summary}${e.detail ? ` — ${e.detail}` : ""}`)
    .join("\n");

  const prompt = `You are summarizing a knowledge-graph page about "${page.title}".
Existing summary:
${page.compiled_truth ?? "(none)"}

Recent timeline entries:
${evidence}

Write a concise 2-3 sentence summary capturing what is currently true about this entity. No preamble. No bullet points.`;

  try {
    const response = await oai().chat.completions.create({
      model: ENRICH_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.2,
    });
    return response.choices[0]?.message?.content?.trim() ?? page.compiled_truth;
  } catch (err) {
    console.error(`refreshCompiledTruth failed for page ${page.id}:`, err);
    return page.compiled_truth;
  }
}
```

- [ ] **Step 3: Verify build**

```bash
pnpm --filter web build 2>&1 | grep -E "(error|Error|Failed|✓ Compiled|✓ Generating)" | head -5
```

Expected: clean build.

- [ ] **Step 4: Write unit test for the prompt construction (skip live LLM)**

Create `apps/web/src/inngest/__tests__/dream-cycle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks for the lazy clients used inside functions.ts.
const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));
const openaiMock = vi.hoisted(() => ({
  chat: { completions: { create: vi.fn() } },
  embeddings: { create: vi.fn() },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => supabaseMock,
}));
vi.mock("openai", () => ({
  default: vi.fn(() => openaiMock),
}));

describe("Dream Cycle compiled_truth refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps existing compiled_truth when no new timeline entries exist", async () => {
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    });

    const { refreshCompiledTruth } = await import("../functions");
    const result = await refreshCompiledTruth({
      id: 1,
      slug: "x",
      title: "X",
      compiled_truth: "Existing summary.",
      timeline: null,
    });

    expect(result).toBe("Existing summary.");
    expect(openaiMock.chat.completions.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Export `refreshCompiledTruth` for the test**

In `apps/web/src/inngest/functions.ts`, change `async function refreshCompiledTruth` to `export async function refreshCompiledTruth`.

- [ ] **Step 6: Run the test**

```bash
pnpm --filter web test
```

Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/inngest/functions.ts apps/web/src/inngest/__tests__/dream-cycle.test.ts
git commit -m "feat(dream): refresh compiled_truth + re-embed when changed"
```

---

### Task B3: Entity extraction + cross-links

**Files:**
- Modify: `apps/web/src/inngest/functions.ts` (extend the enrich step)

- [ ] **Step 1: Add the entity-extraction helper**

Insert above `export const dreamCycle` in `apps/web/src/inngest/functions.ts`:

```ts
interface ExtractedEntity {
  type: "person" | "company" | "project";
  name: string;
  slug: string;
}

export async function extractEntities(text: string): Promise<ExtractedEntity[]> {
  if (!text || text.length < 20) return [];

  const prompt = `Extract real-world entities from the following text. Return a JSON array of objects with "type" (one of: person, company, project), "name" (the entity's display name), and "slug" (kebab-case lowercase, e.g. "garry-tan" or "acme-corp"). Return [] if nothing concrete. No preamble, no prose, JSON only.

Text:
${text.slice(0, 4000)}`;

  try {
    const response = await oai().chat.completions.create({
      model: ENRICH_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? "[]";

    // gpt-4o-mini in JSON mode returns { entities: [...] } or just the array
    // depending on prompt. Handle both shapes.
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : (parsed.entities ?? []);
    return arr.filter(
      (e: unknown): e is ExtractedEntity =>
        typeof e === "object" && e !== null &&
        "type" in e && "name" in e && "slug" in e &&
        ["person", "company", "project"].includes((e as ExtractedEntity).type)
    );
  } catch (err) {
    console.error("extractEntities failed:", err);
    return [];
  }
}

async function upsertEntityAndLink(entity: ExtractedEntity, fromSlug: string) {
  // Upsert the entity page (no embedding yet — it'll get one in its own
  // dream-cycle pass).
  await supa()
    .from("brain_pages")
    .upsert(
      { slug: entity.slug, type: entity.type, title: entity.name },
      { onConflict: "slug", ignoreDuplicates: true }
    );

  // Link from the source page to this entity.
  await supa()
    .from("brain_links")
    .upsert(
      {
        from_slug: fromSlug,
        to_slug: entity.slug,
        link_type: "mentions",
        context: "auto-extracted by dream cycle",
      },
      { onConflict: "from_slug,to_slug,link_type", ignoreDuplicates: true }
    );
}
```

- [ ] **Step 2: Wire entity extraction into the enrich loop**

In the `for (const page of stalePages)` block, **add** an entity extraction step before the `update` call:

```ts
for (const page of stalePages) {
  await step.run(`enrich-page-${page.id}`, async () => {
    const newCompiledTruth = await refreshCompiledTruth(page);

    // Entity extraction runs against the current compiled_truth (the most
    // dense, summarized form of the page). Skip for entity-type pages
    // themselves to avoid recursion.
    if (page.type !== "person" && page.type !== "company" && page.type !== "project") {
      const entities = await extractEntities(newCompiledTruth ?? page.title);
      for (const entity of entities) {
        if (entity.slug === page.slug) continue; // Don't self-link.
        await upsertEntityAndLink(entity, page.slug);
      }
    }

    const updates: Record<string, unknown> = {
      last_enriched_at: new Date().toISOString(),
    };

    if (newCompiledTruth && newCompiledTruth !== page.compiled_truth) {
      updates.compiled_truth = newCompiledTruth;
      updates.embedding = await generateEmbedding(`${page.title} ${newCompiledTruth}`);
    }

    const { error } = await supa()
      .from("brain_pages")
      .update(updates)
      .eq("id", page.id);
    if (error) throw new Error(`update-page-${page.id} failed: ${error.message}`);
  });
}
```

- [ ] **Step 3: Add unit test for entity parsing**

Append to `apps/web/src/inngest/__tests__/dream-cycle.test.ts`:

```ts
describe("Dream Cycle entity extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a JSON-array response", async () => {
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '[{"type":"person","name":"Garry Tan","slug":"garry-tan"}]' } }],
    });

    const { extractEntities } = await import("../functions");
    const result = await extractEntities("Garry Tan announced new YC batch.");

    expect(result).toEqual([{ type: "person", name: "Garry Tan", slug: "garry-tan" }]);
  });

  it("parses a {entities: [...]} response", async () => {
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '{"entities":[{"type":"company","name":"Acme","slug":"acme"}]}' } }],
    });

    const { extractEntities } = await import("../functions");
    const result = await extractEntities("Acme launched their product.");

    expect(result).toEqual([{ type: "company", name: "Acme", slug: "acme" }]);
  });

  it("filters out malformed entries", async () => {
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '[{"type":"animal","name":"Fox","slug":"fox"},{"type":"person","name":"Eve","slug":"eve"}]' } }],
    });

    const { extractEntities } = await import("../functions");
    const result = await extractEntities("Eve and a fox.");

    expect(result).toEqual([{ type: "person", name: "Eve", slug: "eve" }]);
  });

  it("returns empty array on LLM error", async () => {
    openaiMock.chat.completions.create.mockRejectedValue(new Error("rate limit"));

    const { extractEntities } = await import("../functions");
    const result = await extractEntities("anything");

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests + build**

```bash
pnpm --filter web test 2>&1 | tail -10
pnpm --filter web build 2>&1 | grep -E "(error|✓ Compiled|✓ Generating)" | head -5
```

Expected: 5 passing tests, clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/inngest/functions.ts apps/web/src/inngest/__tests__/dream-cycle.test.ts
git commit -m "feat(dream): extract entities + auto-link in compiled_truth"
```

---

## Phase C — Markdown Export

### Task C1: Pure markdown rendering function (TDD)

**Files:**
- Create: `apps/web/src/inngest/markdown.ts`
- Create: `apps/web/src/inngest/__tests__/markdown.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `apps/web/src/inngest/__tests__/markdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderPageToMarkdown, slugToFilePath } from "../markdown";

describe("renderPageToMarkdown", () => {
  it("emits frontmatter + compiled truth + timeline section", () => {
    const md = renderPageToMarkdown({
      id: 1,
      slug: "acme-q3-roadmap",
      type: "concept",
      title: "ACME Q3 Roadmap",
      compiled_truth: "The team agreed to migrate to Supabase.",
      timeline: null,
      frontmatter: { tags: ["roadmap", "eng"] },
      created_at: "2026-04-15T00:00:00Z",
      updated_at: "2026-04-29T00:00:00Z",
    }, []);

    expect(md).toContain("---");
    expect(md).toContain("title: ACME Q3 Roadmap");
    expect(md).toContain("type: concept");
    expect(md).toContain("slug: acme-q3-roadmap");
    expect(md).toContain("tags: [roadmap, eng]");
    expect(md).toContain("## Compiled truth");
    expect(md).toContain("The team agreed to migrate to Supabase.");
  });

  it("includes outgoing links in frontmatter", () => {
    const md = renderPageToMarkdown(
      {
        id: 1,
        slug: "acme",
        type: "company",
        title: "ACME",
        compiled_truth: "",
        timeline: null,
        frontmatter: {},
        created_at: "2026-04-15T00:00:00Z",
        updated_at: "2026-04-29T00:00:00Z",
      },
      [
        { from_slug: "acme", to_slug: "garry-tan", link_type: "mentions" },
        { from_slug: "acme", to_slug: "pattern-x", link_type: "derived-from" },
      ]
    );

    expect(md).toContain("links:");
    expect(md).toContain("- to: garry-tan");
    expect(md).toContain("    type: mentions");
    expect(md).toContain("- to: pattern-x");
    expect(md).toContain("    type: derived-from");
  });

  it("omits the links section when no links exist", () => {
    const md = renderPageToMarkdown(
      {
        id: 1,
        slug: "x",
        type: "concept",
        title: "X",
        compiled_truth: "",
        timeline: null,
        frontmatter: {},
        created_at: "2026-04-15T00:00:00Z",
        updated_at: "2026-04-29T00:00:00Z",
      },
      []
    );
    expect(md).not.toContain("links:");
  });

  it("escapes YAML-unsafe characters in title", () => {
    const md = renderPageToMarkdown(
      {
        id: 1,
        slug: "x",
        type: "concept",
        title: 'Has "quotes" and: colons',
        compiled_truth: "",
        timeline: null,
        frontmatter: {},
        created_at: "2026-04-15T00:00:00Z",
        updated_at: "2026-04-29T00:00:00Z",
      },
      []
    );
    // Quoted-flow style: wrap in double quotes and escape internal quotes.
    expect(md).toContain('title: "Has \\"quotes\\" and: colons"');
  });
});

describe("slugToFilePath", () => {
  it("groups by type", () => {
    expect(slugToFilePath("concept", "acme-roadmap")).toBe("pages/concept/acme-roadmap.md");
    expect(slugToFilePath("person", "garry-tan")).toBe("pages/person/garry-tan.md");
  });

  it("uses concept as the default for unknown types", () => {
    expect(slugToFilePath("unknown", "x")).toBe("pages/concept/x.md");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm --filter web test 2>&1 | tail -10
```

Expected: failing tests with "Cannot find module '../markdown'" or similar.

- [ ] **Step 3: Implement the renderer**

Create `apps/web/src/inngest/markdown.ts`:

```ts
export interface BrainPageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string | null;
  timeline: string | null;
  frontmatter: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BrainLinkRow {
  from_slug: string;
  to_slug: string;
  link_type: string;
}

const KNOWN_TYPES = new Set(["concept", "person", "company", "project", "pattern"]);

function escapeYamlScalar(value: string): string {
  if (/[":#\n&*!|>'%@`]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function renderTags(tags: unknown): string | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const safe = tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/[\[\],"]/g, ""));
  return safe.length > 0 ? `[${safe.join(", ")}]` : null;
}

export function renderPageToMarkdown(page: BrainPageRow, links: BrainLinkRow[]): string {
  const outgoingLinks = links.filter((l) => l.from_slug === page.slug);
  const tags = renderTags(page.frontmatter?.tags);

  const fmLines = [
    "---",
    `title: ${escapeYamlScalar(page.title)}`,
    `type: ${page.type}`,
    `slug: ${page.slug}`,
    `created: ${page.created_at}`,
    `updated: ${page.updated_at}`,
  ];

  if (outgoingLinks.length > 0) {
    fmLines.push("links:");
    for (const link of outgoingLinks) {
      fmLines.push(`  - to: ${link.to_slug}`);
      fmLines.push(`    type: ${link.link_type}`);
    }
  }

  if (tags) {
    fmLines.push(`tags: ${tags}`);
  }

  fmLines.push("---", "");

  const body = [
    "## Compiled truth",
    "",
    page.compiled_truth?.trim() || "_(empty)_",
    "",
  ];

  if (page.timeline?.trim()) {
    body.push("## Timeline", "", page.timeline.trim(), "");
  }

  return [...fmLines, ...body].join("\n");
}

export function slugToFilePath(type: string, slug: string): string {
  const safeType = KNOWN_TYPES.has(type) ? type : "concept";
  return `pages/${safeType}/${slug}.md`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter web test 2>&1 | tail -10
```

Expected: 9 passing tests (5 from B2/B3 + 4 markdown tests + 2 slugToFilePath tests... actually 5 + 4 + 2 = 11). Adjust if numbers shift.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/inngest/markdown.ts apps/web/src/inngest/__tests__/markdown.test.ts
git commit -m "feat(export): pure markdown renderer for brain pages"
```

---

### Task C2: exportToGit Inngest function (Octokit pipeline)

**Files:**
- Modify: `apps/web/src/inngest/functions.ts` (append `exportToGit`)
- Modify: `apps/web/src/app/api/inngest/route.ts` (register)
- Create: `apps/web/src/app/api/export/run/route.ts`

- [ ] **Step 1: Append exportToGit to functions.ts**

Append to `apps/web/src/inngest/functions.ts`:

```ts
import { Octokit } from "@octokit/rest";
import { renderPageToMarkdown, slugToFilePath, type BrainPageRow, type BrainLinkRow } from "./markdown";

let _octokit: Octokit | null = null;
function octo(): Octokit {
  if (!_octokit) {
    _octokit = new Octokit({ auth: process.env.GITHUB_EXPORT_PAT });
  }
  return _octokit;
}

function gitHubTarget(): { owner: string; repo: string; branch: string } | null {
  const repoEnv = process.env.GITHUB_EXPORT_REPO;
  if (!process.env.GITHUB_EXPORT_PAT || !repoEnv) return null;
  const [owner, repo] = repoEnv.split("/");
  if (!owner || !repo) return null;
  return { owner, repo, branch: process.env.GITHUB_EXPORT_BRANCH ?? "main" };
}

// Mirror brain_pages to a user-owned GitHub repo as gbrain-format markdown.
// One-way: Postgres → Markdown. Bypassed entirely if GITHUB_EXPORT_PAT or
// GITHUB_EXPORT_REPO are unset.
export const exportToGit = inngest.createFunction(
  {
    id: "export-to-git",
    name: "Markdown export to GitHub",
    triggers: [
      { event: "dream/cycle.completed" },
      { event: "export/run.requested" },
    ],
  },
  async ({ step, logger }) => {
    const target = gitHubTarget();
    if (!target) {
      logger.info("export-to-git: skipped (GITHUB_EXPORT_* not configured)");
      return { skipped: true };
    }
    const { owner, repo, branch } = target;

    const { pages, links } = await step.run("snapshot", async () => {
      const pagesRes = await supa()
        .from("brain_pages")
        .select("id, slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at");
      if (pagesRes.error) throw new Error(`snapshot pages: ${pagesRes.error.message}`);

      const linksRes = await supa()
        .from("brain_links")
        .select("from_slug, to_slug, link_type");
      if (linksRes.error) throw new Error(`snapshot links: ${linksRes.error.message}`);

      return {
        pages: (pagesRes.data ?? []) as BrainPageRow[],
        links: (linksRes.data ?? []) as BrainLinkRow[],
      };
    });

    if (pages.length === 0) {
      logger.info("export-to-git: nothing to export");
      return { exported: 0 };
    }

    const baseRef = await step.run("get-base-ref", async () => {
      const res = await octo().git.getRef({ owner, repo, ref: `heads/${branch}` });
      return res.data.object.sha;
    });

    const baseTreeSha = await step.run("get-base-tree", async () => {
      const res = await octo().git.getCommit({ owner, repo, commit_sha: baseRef });
      return res.data.tree.sha;
    });

    // Create a blob per page, then assemble a tree, then a commit.
    const treeEntries = await step.run("create-blobs", async () => {
      const entries: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
      for (const page of pages) {
        const content = renderPageToMarkdown(page, links);
        const blob = await octo().git.createBlob({ owner, repo, content, encoding: "utf-8" });
        entries.push({
          path: slugToFilePath(page.type, page.slug),
          mode: "100644",
          type: "blob",
          sha: blob.data.sha,
        });
      }
      return entries;
    });

    const newTreeSha = await step.run("create-tree", async () => {
      const res = await octo().git.createTree({
        owner,
        repo,
        base_tree: baseTreeSha,
        tree: treeEntries,
      });
      return res.data.sha;
    });

    const newCommitSha = await step.run("create-commit", async () => {
      const res = await octo().git.createCommit({
        owner,
        repo,
        message: `wm: brain mirror ${new Date().toISOString().slice(0, 10)}`,
        tree: newTreeSha,
        parents: [baseRef],
      });
      return res.data.sha;
    });

    await step.run("update-ref", async () => {
      await octo().git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: newCommitSha,
        force: false,
      });
    });

    return { exported: pages.length, commit: newCommitSha };
  }
);
```

- [ ] **Step 2: Register exportToGit**

Edit `apps/web/src/app/api/inngest/route.ts`:

```ts
import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import {
  syncCompanyData,
  executePattern,
  dreamCycle,
  exportToGit,
} from "../../../inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncCompanyData,
    executePattern,
    dreamCycle,
    exportToGit,
  ],
});
```

- [ ] **Step 3: Create the manual trigger route**

Create `apps/web/src/app/api/export/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

// POST /api/export/run — manually trigger a Markdown export outside of the
// dream-cycle chain. Auth required.
export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { ids } = await inngest.send({
    name: "export/run.requested",
    data: { triggeredBy: user.id, source: "manual" },
  });

  return NextResponse.json({ ok: true, eventId: ids[0] });
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm --filter web build 2>&1 | grep -E "(error|✓ Compiled|✓ Generating)" | head -5
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/inngest/functions.ts apps/web/src/app/api/inngest/route.ts apps/web/src/app/api/export/run/route.ts
git commit -m "feat(export): exportToGit Inngest function + manual trigger route"
```

---

## Phase D — MCP API Layer

### Task D1: API key generation utility + middleware (TDD)

**Files:**
- Create: `apps/web/src/lib/mcp-auth.ts`
- Create: `apps/web/src/lib/__tests__/mcp-auth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/lib/__tests__/mcp-auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, parseBearerToken } from "../mcp-auth";

describe("generateApiKey", () => {
  it("returns a string starting with wmk_", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^wmk_[A-Za-z0-9_-]+$/);
  });

  it("returns 32+ chars after the prefix", () => {
    const key = generateApiKey();
    expect(key.length).toBeGreaterThanOrEqual(36); // wmk_ (4) + at least 32
  });

  it("returns a different key each call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });
});

describe("hashApiKey", () => {
  it("returns 64 hex chars (SHA-256)", () => {
    const h = hashApiKey("wmk_abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashApiKey("wmk_abc")).toBe(hashApiKey("wmk_abc"));
  });

  it("differs across keys", () => {
    expect(hashApiKey("wmk_a")).not.toBe(hashApiKey("wmk_b"));
  });
});

describe("parseBearerToken", () => {
  it("returns the token from a Bearer header", () => {
    expect(parseBearerToken("Bearer wmk_abc")).toBe("wmk_abc");
  });

  it("returns null for non-Bearer schemes", () => {
    expect(parseBearerToken("Basic xyz")).toBeNull();
  });

  it("returns null for missing header", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
  });

  it("returns null for malformed Bearer", () => {
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter web test 2>&1 | tail -10
```

Expected: failures with module-not-found.

- [ ] **Step 3: Implement mcp-auth.ts**

Create `apps/web/src/lib/mcp-auth.ts`:

```ts
import { createHash, randomBytes } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const KEY_PREFIX = "wmk_";

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) return null;
  return parts[1];
}

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

export interface AuthedRequest {
  userId: string;
  keyId: string;
}

// Returns the authed user (by api_key) or null. Updates last_used_at on
// success (fire-and-forget). Constant-time hash comparison via DB lookup.
export async function authenticateApiKey(rawKey: string | null): Promise<AuthedRequest | null> {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(rawKey);
  const { data, error } = await admin()
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;

  // Fire-and-forget last_used_at bump. Don't await — avoids blocking the
  // request on a write that can lag without consequence.
  void admin()
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);

  return { userId: data.user_id, keyId: data.id };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter web test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/mcp-auth.ts apps/web/src/lib/__tests__/mcp-auth.test.ts
git commit -m "feat(mcp): API key generation, hashing, bearer-token parsing"
```

---

### Task D2: API key CRUD routes

**Files:**
- Create: `apps/web/src/app/api/keys/route.ts`
- Create: `apps/web/src/app/api/keys/[id]/route.ts`

- [ ] **Step 1: Create POST + GET /api/keys**

Create `apps/web/src/app/api/keys/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey, hashApiKey } from "@/lib/mcp-auth";

interface CreateKeyBody {
  label: string;
}

// POST /api/keys — generate a new API key. Returns the raw key ONCE; the
// server only persists its SHA-256 hash, so this is the user's only chance
// to copy it.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: CreateKeyBody;
  try {
    body = (await request.json()) as CreateKeyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.label || typeof body.label !== "string" || body.label.length > 100) {
    return NextResponse.json({ error: "missing_or_invalid_label" }, { status: 400 });
  }

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);

  const { data, error } = await supabase
    .from("api_keys")
    .insert({ user_id: user.id, key_hash: keyHash, label: body.label })
    .select("id, label, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    label: data.label,
    createdAt: data.created_at,
    key: rawKey, // ONE-TIME REVEAL
  });
}

// GET /api/keys — list the caller's non-revoked keys (label + last_used_at,
// not the raw key — we don't have it).
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, label, created_at, last_used_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ keys: data ?? [] });
}
```

- [ ] **Step 2: Create DELETE /api/keys/[id]**

Create `apps/web/src/app/api/keys/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface Params {
  params: Promise<{ id: string }>;
}

// DELETE /api/keys/:id — soft-revoke. Sets revoked_at instead of deleting
// so we keep an audit trail.
export async function DELETE(_: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  // RLS ensures we can only revoke our own keys.

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify build**

```bash
pnpm --filter web build 2>&1 | grep -E "(error|✓ Compiled|✓ Generating)" | head -5
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/keys/
git commit -m "feat(mcp): POST/GET/DELETE /api/keys for API key management"
```

---

### Task D3: MCP HTTP routes — search + page

**Files:**
- Create: `apps/web/src/app/api/mcp/search/route.ts`
- Create: `apps/web/src/app/api/mcp/page/[slug]/route.ts`

- [ ] **Step 1: Create the search route**

Create `apps/web/src/app/api/mcp/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { authenticateApiKey, parseBearerToken } from "@/lib/mcp-auth";

let _supa: ReturnType<typeof createClient> | null = null;
function supa() {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supa;
}

let _openai: OpenAI | null = null;
function oai() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

interface SearchBody {
  query: string;
  match_threshold?: number;
  match_count?: number;
}

// POST /api/mcp/search — vector search over both pages and timeline.
// Auth: Authorization: Bearer wmk_*
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.query || typeof body.query !== "string") {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }

  const threshold = body.match_threshold ?? 0.7;
  const count = Math.min(body.match_count ?? 10, 50);

  const embedRes = await oai().embeddings.create({
    model: "text-embedding-3-small",
    input: body.query,
    encoding_format: "float",
  });
  const embedding = embedRes.data[0].embedding;

  const [pagesRes, timelineRes] = await Promise.all([
    supa().rpc("match_brain_pages", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: count,
    }),
    supa().rpc("match_timeline_entries", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: count,
    }),
  ]);

  if (pagesRes.error || timelineRes.error) {
    return NextResponse.json(
      { error: pagesRes.error?.message ?? timelineRes.error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    pages: pagesRes.data ?? [],
    timeline: timelineRes.data ?? [],
  });
}
```

- [ ] **Step 2: Create the page-fetch route**

Create `apps/web/src/app/api/mcp/page/[slug]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateApiKey, parseBearerToken } from "@/lib/mcp-auth";

let _supa: ReturnType<typeof createClient> | null = null;
function supa() {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supa;
}

interface Params {
  params: Promise<{ slug: string }>;
}

// GET /api/mcp/page/:slug — fetch a single brain page + its outgoing links.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { slug } = await params;

  const [pageRes, linksRes] = await Promise.all([
    supa()
      .from("brain_pages")
      .select("id, slug, type, title, compiled_truth, timeline, frontmatter, created_at, updated_at")
      .eq("slug", slug)
      .maybeSingle(),
    supa()
      .from("brain_links")
      .select("from_slug, to_slug, link_type, context")
      .or(`from_slug.eq.${slug},to_slug.eq.${slug}`),
  ]);

  if (pageRes.error) {
    return NextResponse.json({ error: pageRes.error.message }, { status: 500 });
  }
  if (!pageRes.data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    page: pageRes.data,
    links: linksRes.data ?? [],
  });
}
```

- [ ] **Step 3: Verify build**

```bash
pnpm --filter web build 2>&1 | grep -E "(error|✓ Compiled|✓ Generating)" | head -5
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/mcp/search/ apps/web/src/app/api/mcp/page/
git commit -m "feat(mcp): /api/mcp/search and /api/mcp/page/:slug routes"
```

---

### Task D4: MCP HTTP routes — activity + patterns + trigger

**Files:**
- Create: `apps/web/src/app/api/mcp/activity/route.ts`
- Create: `apps/web/src/app/api/mcp/patterns/route.ts`
- Create: `apps/web/src/app/api/mcp/trigger/route.ts`

- [ ] **Step 1: Create the activity route**

Create `apps/web/src/app/api/mcp/activity/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateApiKey, parseBearerToken } from "@/lib/mcp-auth";

let _supa: ReturnType<typeof createClient> | null = null;
function supa() {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supa;
}

// GET /api/mcp/activity?source=slack&limit=50
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  let query = supa()
    .from("brain_timeline")
    .select("id, page_id, date, source, summary, detail")
    .order("date", { ascending: false })
    .limit(limit);

  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: data ?? [] });
}
```

- [ ] **Step 2: Create the patterns route**

Create `apps/web/src/app/api/mcp/patterns/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateApiKey, parseBearerToken } from "@/lib/mcp-auth";

let _supa: ReturnType<typeof createClient> | null = null;
function supa() {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supa;
}

// GET /api/mcp/patterns?limit=20
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 100);

  const { data, error } = await supa()
    .from("brain_pages")
    .select("id, slug, title, compiled_truth, frontmatter, updated_at")
    .eq("type", "pattern")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    patterns: (data ?? []).map((row) => ({
      id: row.slug,
      title: row.title,
      description: row.compiled_truth,
      frontmatter: row.frontmatter,
      lastUpdated: row.updated_at,
    })),
  });
}
```

- [ ] **Step 3: Create the trigger route**

Create `apps/web/src/app/api/mcp/trigger/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateApiKey, parseBearerToken } from "@/lib/mcp-auth";
import { inngest } from "@/inngest/client";

let _supa: ReturnType<typeof createClient> | null = null;
function supa() {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supa;
}

interface TriggerBody {
  workflowId: string;
  parameters?: Record<string, string>;
}

// POST /api/mcp/trigger — same dispatch path as the brain agent's
// triggerWorkflow tool. Validates the pattern exists, then sends an
// Inngest event.
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(parseBearerToken(request.headers.get("authorization")));
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: TriggerBody;
  try {
    body = (await request.json()) as TriggerBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.workflowId) {
    return NextResponse.json({ error: "missing_workflow_id" }, { status: 400 });
  }

  const idAsNumber = Number(body.workflowId);
  const orFilter = Number.isNaN(idAsNumber)
    ? `slug.eq.${body.workflowId}`
    : `slug.eq.${body.workflowId},id.eq.${idAsNumber}`;

  const { data: pattern, error } = await supa()
    .from("brain_pages")
    .select("id, slug, title")
    .or(orFilter)
    .eq("type", "pattern")
    .maybeSingle();

  if (error || !pattern) {
    return NextResponse.json({ error: "pattern_not_found" }, { status: 404 });
  }

  const { ids } = await inngest.send({
    name: "pattern/execute.requested",
    data: {
      userId: auth.userId,
      patternId: pattern.id,
      patternSlug: pattern.slug,
      parameters: body.parameters ?? {},
    },
  });

  return NextResponse.json({
    ok: true,
    eventId: ids[0],
    patternTitle: pattern.title,
  });
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm --filter web build 2>&1 | grep -E "(error|✓ Compiled|✓ Generating)" | head -5
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/mcp/activity/ apps/web/src/app/api/mcp/patterns/ apps/web/src/app/api/mcp/trigger/
git commit -m "feat(mcp): /api/mcp/activity, /api/mcp/patterns, /api/mcp/trigger"
```

---

## Phase E — MCP CLI Package

### Task E1: Bootstrap @workflow-miner/mcp package

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/README.md`

- [ ] **Step 1: Add the package to the workspace**

Read the current `pnpm-workspace.yaml`:

```bash
cat pnpm-workspace.yaml
```

If it doesn't already include `packages/*`, add:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

(If `packages/*` is already there, this step is a no-op.)

- [ ] **Step 2: Create the package.json**

Create `packages/mcp-server/package.json`:

```json
{
  "name": "@workflow-miner/mcp",
  "version": "0.1.0",
  "description": "Stdio MCP server for the Workflow Miner Company Brain. Lets Claude Code, Cursor, and other MCP clients query your company's brain.",
  "type": "module",
  "bin": {
    "wm-mcp": "./bin/wm-mcp.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "bin",
    "README.md"
  ],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "pnpm build"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `packages/mcp-server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create the README**

Create `packages/mcp-server/README.md`:

```markdown
# @workflow-miner/mcp

Stdio MCP server for the [Workflow Miner](https://github.com/iamgagan/workflow-miner) Company Brain. Exposes your company's brain to any MCP-compatible client (Claude Code, Cursor, etc.) so you can search, fetch pages, list patterns, and trigger workflows from your editor.

## Install

In your MCP client config (e.g. `~/.claude/settings.json`):

```jsonc
{
  "mcpServers": {
    "company-brain": {
      "command": "npx",
      "args": ["-y", "@workflow-miner/mcp"],
      "env": {
        "WM_URL": "https://brain.your-company.com",
        "WM_API_KEY": "wmk_<generate one in /settings/api-keys>"
      }
    }
  }
}
```

## Tools exposed

| Tool | What it does |
|---|---|
| `search_brain` | Vector search over pages + timeline (`POST /api/mcp/search`) |
| `get_page` | Fetch a single brain page by slug (`GET /api/mcp/page/:slug`) |
| `list_recent_activity` | Recent timeline entries, optionally filtered by source |
| `list_patterns` | Detected workflow patterns |
| `trigger_workflow` | Execute a pattern by id or slug |

## License

Private — All rights reserved.
```

- [ ] **Step 5: Install + commit (no build yet, code comes in E2)**

```bash
cd /Users/gagan/Projects/workflow-miner/workflow-miner && pnpm install
git add pnpm-workspace.yaml packages/mcp-server/ pnpm-lock.yaml
git commit -m "chore(mcp): bootstrap @workflow-miner/mcp package"
```

---

### Task E2: Implement the stdio MCP server

**Files:**
- Create: `packages/mcp-server/src/index.ts`
- Create: `packages/mcp-server/bin/wm-mcp.js`

- [ ] **Step 1: Create the bin entry**

Create `packages/mcp-server/bin/wm-mcp.js`:

```js
#!/usr/bin/env node
import("../dist/index.js");
```

Make it executable:

```bash
chmod +x packages/mcp-server/bin/wm-mcp.js
```

- [ ] **Step 2: Create the MCP server**

Create `packages/mcp-server/src/index.ts`:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";

const WM_URL = process.env.WM_URL?.replace(/\/$/, "");
const WM_API_KEY = process.env.WM_API_KEY;

if (!WM_URL || !WM_API_KEY) {
  console.error("[@workflow-miner/mcp] WM_URL and WM_API_KEY env vars are required.");
  process.exit(1);
}

const baseHeaders = {
  Authorization: `Bearer ${WM_API_KEY}`,
  "Content-Type": "application/json",
};

async function http<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${WM_URL}${path}`, {
    method,
    headers: baseHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

const TOOLS = [
  {
    name: "search_brain",
    description: "Search the company brain (semantic vector search over pages and timeline).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query" },
        match_count: { type: "number", description: "Max results (default 10, max 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_page",
    description: "Fetch a single brain page by slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The page slug, e.g. 'acme-q3-roadmap'" },
      },
      required: ["slug"],
    },
  },
  {
    name: "list_recent_activity",
    description: "List recent timeline entries, optionally filtered by source.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Filter by source (gmail, slack, linear, etc.)" },
        limit: { type: "number", description: "Max entries (default 50, max 200)" },
      },
    },
  },
  {
    name: "list_patterns",
    description: "List detected workflow patterns in the company brain.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max patterns (default 20, max 100)" },
      },
    },
  },
  {
    name: "trigger_workflow",
    description: "Execute a workflow pattern by slug or id. Returns an execution event id.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "The pattern's slug or numeric id" },
        parameters: { type: "object", description: "Parameters to pass to the workflow" },
      },
      required: ["workflowId"],
    },
  },
];

const server = new Server(
  { name: "workflow-miner", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;
    switch (name) {
      case "search_brain":
        result = await http("POST", "/api/mcp/search", {
          query: a.query,
          match_count: a.match_count,
        });
        break;
      case "get_page":
        result = await http("GET", `/api/mcp/page/${encodeURIComponent(String(a.slug))}`);
        break;
      case "list_recent_activity": {
        const params = new URLSearchParams();
        if (a.source) params.set("source", String(a.source));
        if (a.limit) params.set("limit", String(a.limit));
        const qs = params.toString();
        result = await http("GET", `/api/mcp/activity${qs ? `?${qs}` : ""}`);
        break;
      }
      case "list_patterns": {
        const params = new URLSearchParams();
        if (a.limit) params.set("limit", String(a.limit));
        const qs = params.toString();
        result = await http("GET", `/api/mcp/patterns${qs ? `?${qs}` : ""}`);
        break;
      }
      case "trigger_workflow":
        result = await http("POST", "/api/mcp/trigger", {
          workflowId: a.workflowId,
          parameters: a.parameters ?? {},
        });
        break;
      default:
        throw new Error(`unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 3: Add the dep + build**

```bash
cd packages/mcp-server && pnpm install && pnpm build
```

Expected: `dist/index.js` and `dist/index.d.ts` exist.

```bash
ls dist/
```
Expected output: `index.d.ts`, `index.d.ts.map`, `index.js`, `index.js.map`.

- [ ] **Step 4: Commit**

```bash
cd /Users/gagan/Projects/workflow-miner/workflow-miner
git add packages/mcp-server/ pnpm-lock.yaml
git commit -m "feat(mcp): implement stdio MCP server with 5 tools"
```

---

### Task E3: Smoke test the MCP server against a running dev server

**Files:** none — this is an integration verification.

- [ ] **Step 1: In a dedicated terminal, start the Next.js dev server**

```bash
pnpm --filter web dev
```

Wait for `Ready in <ms>` log line. Note the port (usually 3000).

This step requires a configured `apps/web/.env.local` with valid Supabase + OpenAI keys, and the Supabase project must have the schema applied. If those aren't ready, skip Task E3 and resume after the env is set up.

- [ ] **Step 2: Generate an API key via curl**

You need a Supabase session cookie. The easiest path: sign in via the browser at http://localhost:3000/login, then in DevTools → Application → Cookies, copy the `sb-*-auth-token` cookies.

```bash
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -H "Cookie: <paste session cookies here>" \
  -d '{"label":"mcp-smoke-test"}'
```

Expected: JSON response with a `key` field starting with `wmk_`. Copy that value.

- [ ] **Step 3: Run the MCP server stdin/stdout against the API**

```bash
WM_URL="http://localhost:3000" WM_API_KEY="wmk_<paste>" \
  node packages/mcp-server/bin/wm-mcp.js
```

The process will hang waiting for JSON-RPC on stdin. Send a `tools/list` request:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

Expected: a JSON response listing all 5 tools. Then test a tool call:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_patterns","arguments":{"limit":5}}}
```

Expected: a response with `content[0].text` containing a JSON string `{"patterns": [...]}`.

Stop the server with Ctrl+C.

- [ ] **Step 4: Document the smoke test result**

If smoke test passes, no commit needed. If anything fails, fix in subsequent steps and re-run.

---

### Task E4: Publish @workflow-miner/mcp to npm

**Files:** none — this is a publish action.

- [ ] **Step 1: Verify you have npm publish credentials**

```bash
npm whoami
```

If not logged in: `npm login`. Verify the org `@workflow-miner` is yours, or change the package name to your scope in `packages/mcp-server/package.json`.

- [ ] **Step 2: Publish**

```bash
cd packages/mcp-server && npm publish
```

Expected: success log with the published version. Verify on npm:

```bash
npm view @workflow-miner/mcp
```

- [ ] **Step 3: Smoke test the published package**

In a tmp dir, run it via npx:

```bash
cd /tmp && WM_URL="http://localhost:3000" WM_API_KEY="wmk_<paste>" npx -y @workflow-miner/mcp
```

Expected: same behavior as Task E3 step 3.

- [ ] **Step 4: Commit any version bump**

If npm publish bumped the version (e.g. via `npm version patch` first), commit:

```bash
git add packages/mcp-server/package.json
git commit -m "chore(mcp): publish @workflow-miner/mcp 0.1.0"
```

---

## Phase F — Settings UI

### Task F1: API Keys settings page

**Files:**
- Create: `apps/web/src/app/(dashboard)/settings/api-keys/page.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/src/app/(dashboard)/settings/api-keys/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trash2, Key, Copy, Check } from "lucide-react";

interface ApiKey {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadKeys() {
    setLoading(true);
    const res = await fetch("/api/keys");
    const data = await res.json();
    setKeys(data.keys ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  async function createKey() {
    if (!newLabel.trim()) return;
    setCreating(true);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setRevealedKey(data.key);
      setNewLabel("");
      await loadKeys();
    }
    setCreating(false);
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this key? Any client using it will lose access immediately.")) return;
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (res.ok) await loadKeys();
  }

  async function copyKey() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate keys to use the Company Brain from Claude Code, Cursor, or any MCP client. See{" "}
          <a className="underline" href="https://www.npmjs.com/package/@workflow-miner/mcp" target="_blank" rel="noopener noreferrer">
            @workflow-miner/mcp
          </a>{" "}
          for setup instructions.
        </p>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Create new key</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Label (e.g. 'gagan-laptop-claude-code')"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            disabled={creating}
          />
          <Button onClick={createKey} disabled={creating || !newLabel.trim()}>
            <Key className="w-4 h-4 mr-2" />
            Create
          </Button>
        </div>
      </Card>

      {revealedKey ? (
        <Card className="p-4 border-amber-500/50 bg-amber-500/5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Your new key — copy it now</h3>
            <Button variant="ghost" size="sm" onClick={() => setRevealedKey(null)}>
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            We hash and never store the raw key. This is the only time you&apos;ll see it.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 bg-muted px-3 py-2 rounded text-xs font-mono break-all">
              {revealedKey}
            </code>
            <Button variant="outline" size="sm" onClick={copyKey}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Active keys</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet. Create one above.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between p-2 rounded border">
                <div>
                  <div className="font-mono text-sm">{key.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Created {new Date(key.created_at).toLocaleDateString()} ·{" "}
                    {key.last_used_at
                      ? `Last used ${new Date(key.last_used_at).toLocaleString()}`
                      : "Never used"}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revokeKey(key.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm --filter web build 2>&1 | grep -E "(error|✓ Compiled|✓ Generating|api-keys)" | head -10
```

Expected: clean build, route `/settings/api-keys` listed in the route table.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/settings/api-keys/"
git commit -m "feat(mcp): /settings/api-keys page (list, create, revoke)"
```

---

### Task F2: Settings buttons for manual Dream Cycle and Export

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/page.tsx` (add a maintenance section)

If `apps/web/src/app/(dashboard)/settings/page.tsx` doesn't exist or has different structure, adapt the patch — the goal is to surface two buttons that POST to the manual triggers.

- [ ] **Step 1: Read the existing settings page**

```bash
cat "apps/web/src/app/(dashboard)/settings/page.tsx" 2>/dev/null | head -60
```

If the file exists, identify a section to append maintenance buttons. If it doesn't exist, create a minimal version:

- [ ] **Step 2: Create or patch settings/page.tsx**

If it didn't exist, create `apps/web/src/app/(dashboard)/settings/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles, Github } from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
  const [dreamStatus, setDreamStatus] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  async function runDreamCycle() {
    setDreamStatus("Dispatching…");
    const res = await fetch("/api/dream/run", { method: "POST" });
    const data = await res.json();
    setDreamStatus(res.ok ? `Dispatched (event ${data.eventId})` : `Error: ${data.error}`);
  }

  async function runExport() {
    setExportStatus("Dispatching…");
    const res = await fetch("/api/export/run", { method: "POST" });
    const data = await res.json();
    setExportStatus(res.ok ? `Dispatched (event ${data.eventId})` : `Error: ${data.error}`);
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <Card className="p-4">
        <h2 className="font-semibold mb-1">API Keys</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Generate keys for the MCP server (Claude Code, Cursor, etc).
        </p>
        <Link href="/settings/api-keys" className="underline text-sm">
          Manage API keys →
        </Link>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> Dream Cycle
        </h2>
        <p className="text-sm text-muted-foreground mb-3">
          Manually trigger the LLM enrichment pass (entity extraction + compiled-truth refresh).
          Normally runs automatically on a cron.
        </p>
        <Button onClick={runDreamCycle}>Run Dream Cycle now</Button>
        {dreamStatus ? <p className="text-xs mt-2 font-mono text-muted-foreground">{dreamStatus}</p> : null}
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-1 flex items-center gap-2">
          <Github className="w-4 h-4" /> Markdown export
        </h2>
        <p className="text-sm text-muted-foreground mb-3">
          Manually push a markdown mirror of the brain to your configured GitHub repo. Requires{" "}
          <code className="text-xs">GITHUB_EXPORT_PAT</code> and{" "}
          <code className="text-xs">GITHUB_EXPORT_REPO</code> env vars.
        </p>
        <Button onClick={runExport}>Run export now</Button>
        {exportStatus ? <p className="text-xs mt-2 font-mono text-muted-foreground">{exportStatus}</p> : null}
      </Card>
    </div>
  );
}
```

If the file already exists with different structure, append the two new `<Card>` sections (Dream Cycle, Markdown export) at the bottom of the existing layout, keeping the existing settings intact.

- [ ] **Step 3: Verify build**

```bash
pnpm --filter web build 2>&1 | grep -E "(error|✓ Compiled|✓ Generating)" | head -5
```

Expected: clean build.

- [ ] **Step 4: Commit and push**

```bash
git add "apps/web/src/app/(dashboard)/settings/page.tsx"
git commit -m "feat(settings): manual triggers for Dream Cycle + Markdown export"
git push
```

---

## Final verification

### Task FINAL: End-to-end verification checklist

- [ ] **Build passes from clean state**

```bash
pnpm install && pnpm --filter @workflow-miner/engine build && pnpm --filter web build
```

Expected: clean build.

- [ ] **Tests pass**

```bash
pnpm --filter web test
```

Expected: all tests pass.

- [ ] **Inngest dev server registers all 4 functions**

In one terminal: `pnpm --filter web dev`. In another: `npx inngest-cli@latest dev`. Open the Inngest dashboard at http://localhost:8288. Verify all 4 functions appear: `sync-company-data`, `execute-pattern`, `dream-cycle`, `export-to-git`.

- [ ] **Schema applies cleanly to a fresh Supabase project**

In Supabase SQL editor, run `packages/engine/src/brain/schema.sql`. Expected: success with no errors.

- [ ] **Update root README with the new features**

Add a brief mention in the existing root `README.md` linking to:
- `/settings/api-keys` for MCP setup
- The new env vars (DREAM_CYCLE_*, GITHUB_EXPORT_*)
- The `@workflow-miner/mcp` npm package

```bash
git add README.md
git commit -m "docs: mention Dream Cycles, MCP server, and Markdown export in root README"
git push
```

---

## Self-review notes

This plan was reviewed against the source spec (`docs/superpowers/specs/2026-04-29-gbrain-alignment-features-design.md`):

**Spec coverage:**
- ✅ Schema additions (Task A1)
- ✅ Dream Cycles (Tasks B1–B3)
- ✅ Markdown export (Tasks C1–C2)
- ✅ MCP API layer (Tasks D1–D4)
- ✅ MCP CLI package (Tasks E1–E4)
- ✅ Settings UI (Tasks F1–F2)
- ✅ Cron + manual triggers
- ✅ Cost cap via DREAM_CYCLE_MAX_PAGES_PER_RUN
- ✅ One-time-reveal API key pattern
- ✅ Tests for the parts where TDD pays (mcp-auth, markdown rendering, entity extraction)

**Placeholder scan:** zero TBDs, TODOs, or "implement later" markers in step bodies. The MVP `executePattern` runtime adapters are explicitly out-of-scope per the spec; not introducing any here.

**Type consistency:** `BrainPageRow` and `BrainLinkRow` exported from `markdown.ts` are reused by `exportToGit`. `AuthedRequest` from `mcp-auth.ts` is consumed by all 5 MCP routes. `ExtractedEntity` lives in `functions.ts` (used internally only).

**Out of scope (explicitly deferred per spec):**
- Two-way sync (markdown → Postgres)
- Per-key rate limiting
- GitHub App vs PAT
- Hosted/SSE MCP server
- Real per-runtime executor adapters (n8n / Zapier / Claude skill pack execution)
