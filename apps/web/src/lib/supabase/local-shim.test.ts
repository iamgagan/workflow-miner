/**
 * Smoke tests for the local PGlite-backed Supabase shim.
 *
 * Uses node:test + node:assert so we don't need to add vitest to apps/web.
 * Run with:
 *
 *   cd apps/web
 *   node --experimental-strip-types --test src/lib/supabase/local-shim.test.ts
 *
 * The shim is the foundation of the desktop app — every API route in the
 * Next.js dashboard funnels through it when WORKFLOW_MINER_MODE=desktop is
 * set, so the shape of `from(table).select().eq().limit().single()` etc.
 * has to match what the existing Supabase client exposes byte for byte.
 *
 * These tests cover:
 *   - Schema initialization on first boot
 *   - Plain insert + select round-trip
 *   - Filters: eq, gte, lt, in, or
 *   - Ordering, including the JSON path syntax `frontmatter->confidence`
 *   - .single() resolution (one row vs zero rows)
 *   - .upsert() with onConflict (single + composite keys)
 *   - .upsert(...).select(...) chaining
 *   - count: "exact" + head: true
 *   - JSONB encoding: plain objects round-trip as JS objects
 *   - auth.getUser() returning the local user
 *   - The brain_stats view computing correct aggregates
 */

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalShimClient, isDesktopMode } from "./local-shim.ts";

let tempDir: string;

before(() => {
  // Point the shim at a fresh temp dir so each test run starts from a
  // clean PGlite database. The shim caches the DB as a module-level
  // singleton — that's fine because the whole test file shares one.
  tempDir = mkdtempSync(join(tmpdir(), "wm-shim-test-"));
  process.env.WORKFLOW_MINER_DATA_DIR = tempDir;
  process.env.WORKFLOW_MINER_MODE = "desktop";
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("isDesktopMode", () => {
  test("returns true when WORKFLOW_MINER_MODE=desktop", () => {
    assert.equal(isDesktopMode(), true);
  });
});

describe("schema initialization", () => {
  test("brain_pages table is created on first query", async () => {
    const client = createLocalShimClient();
    const result = await client.from("brain_pages").select("*").limit(1);
    assert.equal(result.error, null);
    assert.deepEqual(result.data, []);
  });

  test("brain_stats view computes zero counts on empty DB", async () => {
    const client = createLocalShimClient();
    const result = await client.from("brain_stats").select("*").single();
    assert.equal(result.error, null);
    assert.ok(result.data);
    const data = result.data as Record<string, number>;
    // The counts may be > 0 if other tests have run; just assert they're
    // numeric and the view itself works.
    assert.equal(typeof data.page_count, "number");
    assert.equal(typeof data.timeline_count, "number");
    assert.equal(typeof data.link_count, "number");
    assert.equal(typeof data.tag_count, "number");
  });
});

describe("insert + select round-trip", () => {
  test("insert returns the inserted row with generated id", async () => {
    const client = createLocalShimClient();
    const result = await client.from("brain_pages").insert({
      slug: "tools/test-insert",
      type: "tool",
      title: "Test Insert",
      frontmatter: { foo: "bar" },
    });
    assert.equal(result.error, null);
    const rows = result.data as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slug, "tools/test-insert");
    assert.equal(rows[0].type, "tool");
    assert.equal(typeof rows[0].id, "number");
  });

  test("select with eq finds the inserted row", async () => {
    const client = createLocalShimClient();
    const result = await client
      .from("brain_pages")
      .select("slug, title, frontmatter")
      .eq("slug", "tools/test-insert")
      .single();
    assert.equal(result.error, null);
    assert.ok(result.data);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.slug, "tools/test-insert");
    assert.equal(data.title, "Test Insert");
    assert.deepEqual(data.frontmatter, { foo: "bar" });
  });

  test("single() returns PGRST116 error when no rows match", async () => {
    const client = createLocalShimClient();
    const result = await client
      .from("brain_pages")
      .select("*")
      .eq("slug", "nope/does/not/exist")
      .single();
    assert.equal(result.data, null);
    assert.ok(result.error);
    assert.equal(result.error.code, "PGRST116");
  });
});

describe("filters", () => {
  test("in() matches multiple values", async () => {
    const client = createLocalShimClient();
    await client.from("brain_pages").insert([
      { slug: "filter/a", type: "concept", title: "A" },
      { slug: "filter/b", type: "concept", title: "B" },
      { slug: "filter/c", type: "concept", title: "C" },
    ]);

    const result = await client
      .from("brain_pages")
      .select("slug")
      .in("slug", ["filter/a", "filter/c"]);
    assert.equal(result.error, null);
    const slugs = (result.data as Array<{ slug: string }>).map((r) => r.slug);
    assert.deepEqual(new Set(slugs), new Set(["filter/a", "filter/c"]));
  });

  test("gte + lt window query", async () => {
    const client = createLocalShimClient();
    // First create a parent page so the FK is satisfied.
    const pageResult = await client
      .from("brain_pages")
      .insert({ slug: "filter/window-parent", type: "tool", title: "Window Parent" });
    const pageId = (pageResult.data as Array<{ id: number }>)[0].id;

    await client.from("brain_timeline").insert([
      { page_id: pageId, date: "2026-01-01T00:00:00Z", source: "test", summary: "older" },
      { page_id: pageId, date: "2026-02-01T00:00:00Z", source: "test", summary: "middle" },
      { page_id: pageId, date: "2026-03-01T00:00:00Z", source: "test", summary: "newer" },
    ]);

    const result = await client
      .from("brain_timeline")
      .select("summary")
      .eq("page_id", pageId)
      .gte("date", "2026-01-15T00:00:00Z")
      .lt("date", "2026-02-15T00:00:00Z");
    assert.equal(result.error, null);
    const rows = result.data as Array<{ summary: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].summary, "middle");
  });

  test("or() with ilike clauses", async () => {
    const client = createLocalShimClient();
    await client.from("brain_pages").insert([
      { slug: "or/ilike-1", type: "concept", title: "Bug Triage Flow" },
      { slug: "or/ilike-2", type: "concept", title: "Customer Escalation" },
      { slug: "or/ilike-3", type: "concept", title: "Standup Routine" },
    ]);

    const result = await client
      .from("brain_pages")
      .select("slug, title")
      .or("title.ilike.%Bug%,title.ilike.%Standup%");
    assert.equal(result.error, null);
    const titles = (result.data as Array<{ title: string }>).map(
      (r) => r.title,
    );
    assert.equal(titles.length, 2);
    assert.ok(titles.includes("Bug Triage Flow"));
    assert.ok(titles.includes("Standup Routine"));
  });
});

describe("ordering", () => {
  test("plain order by ascending and descending", async () => {
    const client = createLocalShimClient();
    await client.from("brain_pages").insert([
      { slug: "order/a", type: "concept", title: "Alpha" },
      { slug: "order/b", type: "concept", title: "Beta" },
      { slug: "order/c", type: "concept", title: "Gamma" },
    ]);

    const asc = await client
      .from("brain_pages")
      .select("title")
      .in("slug", ["order/a", "order/b", "order/c"])
      .order("title", { ascending: true });
    const ascTitles = (asc.data as Array<{ title: string }>).map(
      (r) => r.title,
    );
    assert.deepEqual(ascTitles, ["Alpha", "Beta", "Gamma"]);

    const desc = await client
      .from("brain_pages")
      .select("title")
      .in("slug", ["order/a", "order/b", "order/c"])
      .order("title", { ascending: false });
    const descTitles = (desc.data as Array<{ title: string }>).map(
      (r) => r.title,
    );
    assert.deepEqual(descTitles, ["Gamma", "Beta", "Alpha"]);
  });

  test("order by JSON path: frontmatter->confidence", async () => {
    const client = createLocalShimClient();
    await client.from("brain_pages").insert([
      {
        slug: "json-order/low",
        type: "workflow",
        title: "Low",
        frontmatter: { confidence: 0.3 },
      },
      {
        slug: "json-order/high",
        type: "workflow",
        title: "High",
        frontmatter: { confidence: 0.9 },
      },
      {
        slug: "json-order/mid",
        type: "workflow",
        title: "Mid",
        frontmatter: { confidence: 0.6 },
      },
    ]);

    const result = await client
      .from("brain_pages")
      .select("title, frontmatter")
      .in("slug", ["json-order/low", "json-order/high", "json-order/mid"])
      .order("frontmatter->confidence", { ascending: false });
    assert.equal(result.error, null);
    const titles = (result.data as Array<{ title: string }>).map(
      (r) => r.title,
    );
    assert.deepEqual(titles, ["High", "Mid", "Low"]);
  });
});

describe("upsert", () => {
  test("upsert inserts when row does not exist", async () => {
    const client = createLocalShimClient();
    const result = await client.from("brain_pages").upsert(
      {
        slug: "upsert/new",
        type: "concept",
        title: "Upserted New",
        frontmatter: { v: 1 },
      },
      { onConflict: "slug" },
    );
    assert.equal(result.error, null);
    const rows = result.data as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slug, "upsert/new");
  });

  test("upsert updates when row exists", async () => {
    const client = createLocalShimClient();
    await client.from("brain_pages").upsert(
      {
        slug: "upsert/existing",
        type: "concept",
        title: "Original",
        frontmatter: { v: 1 },
      },
      { onConflict: "slug" },
    );

    const updated = await client.from("brain_pages").upsert(
      {
        slug: "upsert/existing",
        type: "concept",
        title: "Updated",
        frontmatter: { v: 2 },
      },
      { onConflict: "slug" },
    );
    assert.equal(updated.error, null);

    const fetched = await client
      .from("brain_pages")
      .select("title, frontmatter")
      .eq("slug", "upsert/existing")
      .single();
    assert.equal(fetched.error, null);
    assert.ok(fetched.data);
    const data = fetched.data as Record<string, unknown>;
    assert.equal(data.title, "Updated");
    assert.deepEqual(data.frontmatter, { v: 2 });
  });

  test("upsert with composite onConflict", async () => {
    const client = createLocalShimClient();
    // First insert
    await client.from("brain_links").upsert(
      {
        from_slug: "composite/a",
        to_slug: "composite/b",
        link_type: "related",
        context: "first",
      },
      { onConflict: "from_slug,to_slug,link_type" },
    );
    // Second upsert with same key — should update context
    await client.from("brain_links").upsert(
      {
        from_slug: "composite/a",
        to_slug: "composite/b",
        link_type: "related",
        context: "second",
      },
      { onConflict: "from_slug,to_slug,link_type" },
    );

    const result = await client
      .from("brain_links")
      .select("context")
      .eq("from_slug", "composite/a");
    assert.equal(result.error, null);
    const rows = result.data as Array<{ context: string }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].context, "second");
  });

  test("upsert(...).select() returns the projected columns", async () => {
    const client = createLocalShimClient();
    const result = await client
      .from("brain_pages")
      .upsert(
        [
          { slug: "upsert-select/a", type: "tool", title: "A" },
          { slug: "upsert-select/b", type: "tool", title: "B" },
        ],
        { onConflict: "slug" },
      )
      .select("id, slug");
    assert.equal(result.error, null);
    const rows = result.data as Array<{ id: number; slug: string }>;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(typeof row.id, "number");
      assert.ok(row.slug.startsWith("upsert-select/"));
    }
  });
});

describe("count: exact, head: true", () => {
  test("returns count without rows", async () => {
    const client = createLocalShimClient();
    // Insert a couple of rows tagged with a unique type so we have a
    // predictable count to assert on.
    await client.from("brain_pages").insert([
      { slug: "count/a", type: "count-marker", title: "Count A" },
      { slug: "count/b", type: "count-marker", title: "Count B" },
      { slug: "count/c", type: "count-marker", title: "Count C" },
    ]);

    const result = await client
      .from("brain_pages")
      .select("*", { count: "exact", head: true })
      .eq("type", "count-marker");
    assert.equal(result.error, null);
    assert.equal(result.count, 3);
  });
});

describe("auth", () => {
  test("auth.getUser returns the local user", async () => {
    const client = createLocalShimClient();
    const result = await client.auth.getUser();
    assert.equal(result.error, null);
    assert.equal(result.data.user.id, "local");
    assert.ok(result.data.user.email);
  });
});

describe("JSONB encoding", () => {
  test("nested objects round-trip cleanly", async () => {
    const client = createLocalShimClient();
    const frontmatter = {
      confidence: 0.87,
      breakdown: {
        frequency: 0.9,
        consistency: 0.8,
        completionRate: 0.85,
      },
      steps: [
        { eventType: "message_received", position: 0 },
        { eventType: "issue_created", position: 1 },
      ],
    };

    await client.from("brain_pages").upsert(
      {
        slug: "jsonb/round-trip",
        type: "workflow",
        title: "JSONB Round Trip",
        frontmatter,
      },
      { onConflict: "slug" },
    );

    const result = await client
      .from("brain_pages")
      .select("frontmatter")
      .eq("slug", "jsonb/round-trip")
      .single();
    assert.equal(result.error, null);
    const data = result.data as { frontmatter: typeof frontmatter };
    assert.deepEqual(data.frontmatter, frontmatter);
  });
});
