/**
 * Local Supabase-compatible shim backed by PGlite (embedded Postgres via WASM).
 *
 * Used in desktop mode to keep all existing API routes working without
 * modification. Implements the narrow subset of the Supabase JS client that
 * the rest of the codebase actually calls:
 *
 *   - client.from(table).select(cols, { count, head }?)
 *                        .eq(col, val)
 *                        .gte(col, val)
 *                        .lt(col, val)
 *                        .in(col, vals)
 *                        .or(expr)
 *                        .order(col, { ascending })       // supports JSON paths
 *                        .limit(n)
 *                        .single()
 *   - client.from(table).insert(row | rows)
 *   - client.from(table).upsert(row | rows, { onConflict }).select(cols?)
 *   - client.auth.getUser()                                // returns local user
 *   - client.auth.signInWithPassword / signUp / signInWithOAuth / signOut /
 *     exchangeCodeForSession                               // stubs (auth bypassed)
 *
 * PGlite gives us real Postgres semantics (JSONB, TIMESTAMPTZ, ilike, JSON path
 * ordering), so the existing `brain/schema.sql` runs verbatim and queries like
 * `.order("frontmatter->confidence", { ascending: false })` work natively.
 *
 * IMPORTANT: this module must only be imported in Node runtime routes. It is
 * gated behind `WORKFLOW_MINER_MODE === "desktop"` in the supabase client
 * factories (`server.ts`, `admin.ts`).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// PGlite is imported lazily to keep it out of the bundle until desktop mode
// actually activates a request.
type PGliteInstance = {
  query: <T = any>(
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
  /** Resolves when the WASM Postgres engine has finished initializing. */
  waitReady?: Promise<void>;
  /** In PGlite 0.2.x `ready` is a boolean indicating whether init completed. */
  ready?: boolean;
};

// ── Schema ───────────────────────────────────────────────────────────

/**
 * Schema applied on first boot of the local brain database.
 * Kept in sync with `packages/engine/src/brain/schema.sql` plus the extra
 * tables the web app uses (`connector_tokens`, `activity_log`) that in hosted
 * mode live under Supabase Auth RLS.
 *
 * Includes the pgvector extension + `embedding vector(1536)` columns so the
 * /brain agent's `match_timeline_entries` / `match_brain_pages` RPCs work
 * locally. The HNSW indexes from the cloud schema are skipped here — they
 * speed up cosine similarity over millions of rows but slow down small
 * desktop datasets and aren't needed when the timeline has < 100k entries.
 */
/**
 * Core schema — does NOT depend on the vector extension. This means
 * connector OAuth, sync, ingest, pattern mining, and markdown export all
 * keep working even if pgvector fails to load. Embedding columns are
 * added by SCHEMA_VECTOR below in a try/catch so a vector-extension
 * failure degrades the brain similarity search but doesn't take down the
 * rest of the app.
 *
 * Caught by alpha.12 user report: a corrupt persistent PGlite directory
 * caused open to fail with `ExitStatus exit(1)`, the in-memory fallback
 * also failed (vector load went sideways once the original WASM context
 * crashed), and connector OAuth surfaced "extension vector is not
 * available" — even though connector_tokens has no vector columns.
 * Splitting the schema isolates the failure mode.
 */
const SCHEMA_CORE = `
CREATE TABLE IF NOT EXISTS brain_pages (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'concept',
  title TEXT NOT NULL,
  compiled_truth TEXT DEFAULT '',
  timeline TEXT DEFAULT '',
  frontmatter JSONB DEFAULT '{}'::jsonb,
  content_hash TEXT,
  last_enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_timeline (
  id SERIAL PRIMARY KEY,
  page_id INTEGER REFERENCES brain_pages(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_links (
  id SERIAL PRIMARY KEY,
  from_slug TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'related',
  context TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_slug, to_slug, link_type)
);

CREATE TABLE IF NOT EXISTS brain_tags (
  slug TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (slug, tag)
);

CREATE OR REPLACE VIEW brain_stats AS
SELECT
  (SELECT COUNT(*) FROM brain_pages) AS page_count,
  (SELECT COUNT(*) FROM brain_timeline) AS timeline_count,
  (SELECT COUNT(*) FROM brain_links) AS link_count,
  (SELECT COUNT(*) FROM brain_tags) AS tag_count;

CREATE TABLE IF NOT EXISTS connector_tokens (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local',
  provider TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ,
  scopes TEXT DEFAULT '',
  tokens JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local',
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

/**
 * Vector-dependent schema. Adds the embedding columns + extension. Run
 * after SCHEMA_CORE in a try/catch so a pgvector failure logs a warning
 * but doesn't break the app — /brain similarity search returns empty in
 * that case, but everything else (mining, OAuth, dream cycle except
 * embedding generation, markdown export) continues to work.
 */
const SCHEMA_VECTOR = `
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE brain_pages    ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE brain_timeline ADD COLUMN IF NOT EXISTS embedding vector(1536);
`;

// ── DB boot & singleton ──────────────────────────────────────────────

let dbPromise: Promise<PGliteInstance> | null = null;

/**
 * Resolve the on-disk directory where PGlite should persist its data.
 * In desktop mode this is `~/Library/Application Support/WorkflowMiner/brain`
 * on macOS. Can be overridden with `WORKFLOW_MINER_DATA_DIR`.
 */
function resolveDataDir(): string {
  const override = process.env.WORKFLOW_MINER_DATA_DIR;
  if (override) return override;

  const platform = os.platform();
  const home = os.homedir();

  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "WorkflowMiner", "brain");
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "WorkflowMiner", "brain");
  }
  // Linux / other
  const xdg = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return path.join(xdg, "workflow-miner", "brain");
}

/**
 * Error patterns emitted when PGlite's Emscripten-compiled WASM module hits a
 * C-level assertion or memory fault. These are unrecoverable for the current
 * instance — the only remedy is to tear it down and re-initialise.
 */
const WASM_CRASH_PATTERNS = [
  "Aborted()",
  "RuntimeError: unreachable",
  "RuntimeError: memory access out of bounds",
  // PGlite throws an ExitStatus object when the WASM postmaster aborts
  // mid-query (e.g. on CHECK constraint violations the engine's exception
  // path can't unwind cleanly). Treating this as a crash tears the
  // singleton down and re-inits cleanly. Patterns are precise — bare
  // "ExitStatus" would false-match unrelated errors that mention the
  // word in passing; we use the exact serialized forms describeError
  // produces (`ExitStatus(status=...)`) and Emscripten's standard
  // wrapper text instead.
  "Program terminated with exit(",
  "ExitStatus(status=",
];

function isWasmCrash(message: string): boolean {
  return WASM_CRASH_PATTERNS.some((p) => message.includes(p));
}

/**
 * Pull a human-readable message out of any thrown value. PGlite throws
 * objects (ExitStatus, postgres errors with severity/code/detail/hint
 * fields) that are NOT JS Error instances — the previous
 * `err instanceof Error ? err.message : String(err)` pattern lost those
 * to the literal "[object Object]" string. This helper preserves the
 * PostgreSQL message + code + detail when present, so callers see
 * actionable error text instead of a placeholder.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === "string") parts.push(obj.message);
    if (typeof obj.code === "string") parts.push(`(code ${obj.code})`);
    if (typeof obj.detail === "string") parts.push(`detail: ${obj.detail}`);
    if (typeof obj.hint === "string") parts.push(`hint: ${obj.hint}`);
    if (parts.length > 0) return parts.join(" ");
    if (typeof obj.name === "string" && typeof obj.status !== "undefined") {
      return `${obj.name}(status=${String(obj.status)})`;
    }
    try { return JSON.stringify(err); } catch { /* fall through */ }
  }
  return String(err);
}

async function bootDb(): Promise<PGliteInstance> {
  const dataDir = resolveDataDir();
  await fs.mkdir(dataDir, { recursive: true });

  // Lazy import so PGlite stays out of non-desktop bundles. We also load the
  // pgvector extension so the /brain agent's similarity RPCs work locally
  // without needing a hosted Postgres. The extension is shipped in the
  // PGlite wasm package and registered via the `extensions` constructor
  // option introduced in 0.2.x.
  const [{ PGlite }, vectorMod] = await Promise.all([
    import("@electric-sql/pglite") as Promise<{
      PGlite: new (
        dataDir?: string,
        options?: { extensions?: Record<string, unknown> },
      ) => PGliteInstance;
    }>,
    import("@electric-sql/pglite/vector").catch(() => null),
  ]);

  const extensions: Record<string, unknown> | undefined =
    vectorMod && "vector" in vectorMod
      ? { vector: (vectorMod as { vector: unknown }).vector }
      : undefined;

  let db: PGliteInstance;
  try {
    db = new PGlite(dataDir, extensions ? { extensions } : undefined);

    // Wait for the WASM Postgres engine to finish booting before issuing any
    // SQL.  PGlite 0.2.x exposes `waitReady` as a Promise that resolves once
    // the internal Emscripten module is fully initialised; the constructor
    // kicks off the async init internally but `exec`/`query` are NOT
    // guaranteed to wait for it.
    if (db.waitReady) await db.waitReady;

    await applySchema(db);
    return db;
  } catch (err) {
    const message = describeError(err);
    // If the WASM module crashed with a persistent-storage database, fall
    // back to an ephemeral in-memory instance so the app remains usable.
    if (isWasmCrash(message)) {
      console.warn(
        `[local-shim] PGlite WASM crashed with persistent storage (${dataDir}): ${message} — retrying in-memory`,
      );
      const memDb = new PGlite(undefined, extensions ? { extensions } : undefined);
      if (memDb.waitReady) await memDb.waitReady;
      await applySchema(memDb);
      return memDb;
    }
    throw err;
  }
}

/**
 * Apply the brain schema in two passes so a pgvector failure doesn't
 * take down core tables. The core pass MUST succeed (otherwise the app
 * is unusable). The vector pass is best-effort: if pgvector can't load,
 * we log a warning and continue. /brain similarity search returns empty
 * in that case but pattern mining, connector OAuth, sync, dream cycle
 * (compiled-truth refresh + entity extraction; embedding generation
 * fails gracefully), and markdown export all keep working.
 */
async function applySchema(db: PGliteInstance): Promise<void> {
  await db.exec(SCHEMA_CORE);
  try {
    await db.exec(SCHEMA_VECTOR);
  } catch (err) {
    console.warn(
      `[local-shim] pgvector unavailable (${describeError(err)}); embeddings + /brain search disabled this session`,
    );
  }
}

/**
 * Reset the module-level PGlite singleton. Called when a WASM crash is
 * detected so the next `getDb()` call re-runs `bootDb()`.
 */
function resetDb(): void {
  dbPromise = null;
}

function getDb(): Promise<PGliteInstance> {
  if (!dbPromise) {
    dbPromise = bootDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// ── Query builder ────────────────────────────────────────────────────

type Filter =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "gte"; col: string; val: unknown }
  | { kind: "lt"; col: string; val: unknown }
  | { kind: "in"; col: string; vals: readonly unknown[] }
  | { kind: "is"; col: string; val: null | boolean }
  | { kind: "or"; expr: string };

interface QueryState {
  readonly table: string;
  op: "select" | "insert" | "upsert" | "delete" | "update";
  columns: string;
  filters: Filter[];
  orderBy: { col: string; ascending: boolean } | null;
  limit: number | null;
  insertRows: any[];
  upsertOnConflict: string | null;
  updateValues: Record<string, unknown>;
  returnSelect: string | null;
  count: "exact" | null;
  head: boolean;
}

interface ShimResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

/**
 * Parse a column spec that may be a plain name or a JSON path
 * (e.g. `frontmatter->confidence`). Returns a SQL-safe expression.
 */
function columnExpr(col: string): string {
  if (col.includes("->")) {
    const [base, ...rest] = col.split("->");
    // Ensure we use ->> for the final segment (text cast) when used for
    // ordering on numerics wrapped in JSON — Postgres coerces as needed.
    let expr = quoteIdent(base.trim());
    for (const segment of rest) {
      const key = segment.trim().replace(/['"]/g, "");
      expr += `->'${key}'`;
    }
    return expr;
  }
  return quoteIdent(col);
}

function quoteIdent(ident: string): string {
  // Allow bare identifiers and splat
  if (ident === "*") return "*";
  // If it's a comma list (from select("a, b, c")), keep as-is
  if (ident.includes(",")) {
    return ident
      .split(",")
      .map((s) => quoteIdent(s.trim()))
      .join(", ");
  }
  return `"${ident.replace(/"/g, '""')}"`;
}

function selectExpr(columns: string): string {
  if (!columns || columns === "*") return "*";
  return columns
    .split(",")
    .map((c) => {
      const trimmed = c.trim();
      if (trimmed === "*") return "*";
      return quoteIdent(trimmed);
    })
    .join(", ");
}

/**
 * Escape an identifier list that looks like `col1, col2` for use in ON CONFLICT.
 */
function onConflictClause(target: string | null): string {
  if (!target) return "";
  const cols = target
    .split(",")
    .map((c) => quoteIdent(c.trim()))
    .join(", ");
  return `ON CONFLICT (${cols})`;
}

/**
 * Note: this class is a thenable but does not formally `implements
 * PromiseLike<...>` because the awaited shape changes between `.single()`
 * (returns one row) and the default path (returns an array of rows).
 * TypeScript awaits the thenable correctly regardless.
 */
class QueryBuilder<T = any> {
  private readonly state: QueryState;
  private db: Promise<PGliteInstance>;

  constructor(table: string, db: Promise<PGliteInstance>) {
    this.db = db;
    this.state = {
      table,
      op: "select",
      columns: "*",
      filters: [],
      orderBy: null,
      limit: null,
      insertRows: [],
      upsertOnConflict: null,
      updateValues: {},
      returnSelect: null,
      count: null,
      head: false,
    };
  }

  select(
    columns: string = "*",
    options: { count?: "exact"; head?: boolean } = {},
  ): this {
    if (this.state.op === "upsert") {
      // Chained .upsert(...).select("...") — capture the return projection
      this.state.returnSelect = columns;
      return this;
    }
    this.state.op = "select";
    this.state.columns = columns || "*";
    this.state.count = options.count ?? null;
    this.state.head = options.head ?? false;
    return this;
  }

  insert(rows: any | any[]): this {
    this.state.op = "insert";
    this.state.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: any | any[], options: { onConflict?: string } = {}): this {
    this.state.op = "upsert";
    this.state.insertRows = Array.isArray(rows) ? rows : [rows];
    this.state.upsertOnConflict = options.onConflict ?? null;
    return this;
  }

  /**
   * Delete rows matching the chained filters. Mirrors the Supabase pattern:
   *   client.from("brain_timeline").delete().eq("source", "gmail")
   *
   * Without any filters this becomes `DELETE FROM <table>` — useful for
   * the seed-brain reset path. We require either at least one filter or
   * an explicit no-op `.neq("id", 0)`-style guard at the call site to
   * avoid accidental table wipes; the API route layer is responsible for
   * that, this method does not enforce it.
   */
  delete(): this {
    this.state.op = "delete";
    return this;
  }

  /**
   * UPDATE rows matching the chained `.eq()` filters with the given values.
   *   client.from("connector_tokens")
   *     .update({ updated_at: new Date().toISOString() })
   *     .eq("user_id", userId)
   *     .eq("provider", "google")
   *
   * No-op if no filters are set — matches Supabase's safety behaviour for
   * filterless UPDATEs (which would otherwise rewrite every row).
   */
  update(values: Record<string, unknown>): this {
    this.state.op = "update";
    this.state.updateValues = values;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.state.filters.push({ kind: "eq", col, val });
    return this;
  }

  gte(col: string, val: unknown): this {
    this.state.filters.push({ kind: "gte", col, val });
    return this;
  }

  lt(col: string, val: unknown): this {
    this.state.filters.push({ kind: "lt", col, val });
    return this;
  }

  in(col: string, vals: readonly unknown[]): this {
    this.state.filters.push({ kind: "in", col, vals });
    return this;
  }

  /**
   * Supabase `.is(col, null|true|false)` — translates to `col IS NULL`,
   * `col IS TRUE`, `col IS FALSE`. The only forms used in this codebase
   * are null checks (e.g. dream-cycle backfill of timeline embeddings).
   */
  is(col: string, val: null | boolean): this {
    this.state.filters.push({ kind: "is", col, val });
    return this;
  }

  or(expr: string): this {
    this.state.filters.push({ kind: "or", expr });
    return this;
  }

  order(col: string, options: { ascending?: boolean } = {}): this {
    this.state.orderBy = {
      col,
      ascending: options.ascending !== false,
    };
    return this;
  }

  limit(n: number): this {
    this.state.limit = n;
    return this;
  }

  async single<U = T>(): Promise<ShimResult<U>> {
    this.state.limit = 1;
    const result = await this.execute<U[]>();
    if (result.error) {
      return { data: null, error: result.error };
    }
    const rows = (result.data ?? []) as U[];
    if (rows.length === 0) {
      return {
        data: null,
        error: { message: "No rows found", code: "PGRST116" },
      };
    }
    return { data: rows[0] as U, error: null };
  }

  // Thenable — allows `await builder` without needing .exec()
  then<TResult1 = ShimResult<T[]>, TResult2 = never>(
    onFulfilled?:
      | ((value: ShimResult<T[]>) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onRejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
      | undefined,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute<T[]>().then(onFulfilled, onRejected);
  }

  private async execute<U>(retry = true): Promise<ShimResult<U>> {
    try {
      const db = await this.db;
      switch (this.state.op) {
        case "select":
          return await this.executeSelect<U>(db);
        case "insert":
          return await this.executeInsert<U>(db);
        case "upsert":
          return await this.executeUpsert<U>(db);
        case "delete":
          return await this.executeDelete<U>(db);
        case "update":
          return await this.executeUpdate<U>(db);
      }
    } catch (err) {
      const message = describeError(err);

      // If the WASM module crashed, discard the dead singleton and retry
      // once with a freshly initialised PGlite instance.
      if (isWasmCrash(message) && retry) {
        console.warn("[local-shim] WASM crash detected, reinitialising PGlite…");
        resetDb();
        this.db = getDb();
        return this.execute<U>(false);
      }

      // Detect "relation does not exist" for parity with Supabase's 42P01 code
      const code = /does not exist/i.test(message) ? "42P01" : undefined;
      return { data: null, error: { message, code } };
    }
  }

  private buildWhere(paramOffset = 0): { sql: string; params: unknown[] } {
    if (this.state.filters.length === 0) return { sql: "", params: [] };
    const parts: string[] = [];
    const params: unknown[] = [];

    const placeholder = () => `$${paramOffset + params.length}`;

    for (const f of this.state.filters) {
      switch (f.kind) {
        case "eq":
          params.push(f.val);
          parts.push(`${columnExpr(f.col)} = ${placeholder()}`);
          break;
        case "gte":
          params.push(f.val);
          parts.push(`${columnExpr(f.col)} >= ${placeholder()}`);
          break;
        case "lt":
          params.push(f.val);
          parts.push(`${columnExpr(f.col)} < ${placeholder()}`);
          break;
        case "in": {
          if (f.vals.length === 0) {
            parts.push("FALSE");
            break;
          }
          const placeholders: string[] = [];
          for (const v of f.vals) {
            params.push(v);
            placeholders.push(placeholder());
          }
          parts.push(`${columnExpr(f.col)} IN (${placeholders.join(", ")})`);
          break;
        }
        case "is": {
          // IS NULL / IS TRUE / IS FALSE — no parameter binding (these are
          // SQL keywords, not values).
          const literal =
            f.val === null ? "NULL" : f.val === true ? "TRUE" : "FALSE";
          parts.push(`${columnExpr(f.col)} IS ${literal}`);
          break;
        }
        case "or": {
          // Translate Supabase's or("a.ilike.x,b.ilike.y") → (a ILIKE x OR b ILIKE y)
          parts.push(`(${translateOrExpr(f.expr, params, paramOffset)})`);
          break;
        }
      }
    }

    return { sql: ` WHERE ${parts.join(" AND ")}`, params };
  }

  private async executeSelect<U>(db: PGliteInstance): Promise<ShimResult<U>> {
    const { sql: whereSql, params } = this.buildWhere();

    // Head/count path — return just the count, no rows
    if (this.state.head && this.state.count === "exact") {
      const countSql = `SELECT COUNT(*)::int AS c FROM ${quoteIdent(
        this.state.table,
      )}${whereSql}`;
      const result = await db.query<{ c: number }>(countSql, params);
      const count = result.rows[0]?.c ?? 0;
      return { data: null as any, error: null, count };
    }

    const cols = selectExpr(this.state.columns);
    let sql = `SELECT ${cols} FROM ${quoteIdent(this.state.table)}${whereSql}`;

    if (this.state.orderBy) {
      const dir = this.state.orderBy.ascending ? "ASC" : "DESC";
      sql += ` ORDER BY ${columnExpr(this.state.orderBy.col)} ${dir}`;
    }
    if (this.state.limit != null) {
      sql += ` LIMIT ${this.state.limit}`;
    }

    const result = await db.query(sql, params);
    const rows = result.rows;

    let count: number | null = null;
    if (this.state.count === "exact") {
      const countSql = `SELECT COUNT(*)::int AS c FROM ${quoteIdent(
        this.state.table,
      )}${whereSql}`;
      const countResult = await db.query<{ c: number }>(countSql, params);
      count = countResult.rows[0]?.c ?? 0;
    }

    return { data: rows as U, error: null, count };
  }

  private async executeInsert<U>(db: PGliteInstance): Promise<ShimResult<U>> {
    if (this.state.insertRows.length === 0) {
      return { data: [] as U, error: null };
    }
    const { sql, params } = buildInsertSql(
      this.state.table,
      this.state.insertRows,
      null,
      null,
    );
    const result = await db.query(sql, params);
    return { data: result.rows as U, error: null };
  }

  private async executeUpsert<U>(db: PGliteInstance): Promise<ShimResult<U>> {
    if (this.state.insertRows.length === 0) {
      return { data: [] as U, error: null };
    }
    const { sql, params } = buildInsertSql(
      this.state.table,
      this.state.insertRows,
      this.state.upsertOnConflict,
      this.state.returnSelect,
    );
    const result = await db.query(sql, params);
    return { data: result.rows as U, error: null };
  }

  private async executeDelete<U>(db: PGliteInstance): Promise<ShimResult<U>> {
    const { sql: whereSql, params } = this.buildWhere();
    const sql = `DELETE FROM ${quoteIdent(this.state.table)}${whereSql}`;
    const result = await db.query(sql, params);
    return { data: result.rows as U, error: null };
  }

  private async executeUpdate<U>(db: PGliteInstance): Promise<ShimResult<U>> {
    const entries = Object.entries(this.state.updateValues);
    if (entries.length === 0) {
      return { data: [] as unknown as U, error: null };
    }
    if (this.state.filters.length === 0) {
      return {
        data: null,
        error: {
          message: "UPDATE without WHERE filter is refused by local-shim",
        },
      };
    }
    const params: unknown[] = [];
    const setClauses = entries.map(([col, val]) => {
      const placeholder = renderValuePlaceholder(val, params);
      return `${quoteIdent(col)} = ${placeholder}`;
    });
    const { sql: whereSql, params: whereParams } = this.buildWhere(params.length);
    params.push(...whereParams);
    const sql = `UPDATE ${quoteIdent(this.state.table)} SET ${setClauses.join(", ")}${whereSql}`;
    const result = await db.query(sql, params);
    return { data: result.rows as U, error: null };
  }
}

/**
 * Push `val` onto `params` and return the SQL placeholder that should
 * appear at that position, with type casts injected when necessary.
 *
 * pgvector's column type is `vector(N)`. PGlite's parameter binder won't
 * coerce a text array literal to vector implicitly — without a `::vector`
 * cast the UPDATE/INSERT throws a type-mismatch error and the row is not
 * written. Detect numeric arrays (Float32Array or number[]) and add the
 * cast. Other types pass through unchanged.
 *
 * Caught by alpha.14 user report: Dream Cycle ran, the embedding loop
 * fired, but every brain_timeline.embedding update failed silently
 * because the pgvector column rejected the un-cast text literal — so
 * /brain similarity search always returned zero rows even after the
 * env-var guard was removed.
 */
function renderValuePlaceholder(val: unknown, params: unknown[]): string {
  // Float32Array (the AI SDK's preferred wire format for embeddings) +
  // plain number[] both need ::vector cast.
  if (
    val instanceof Float32Array ||
    (Array.isArray(val) && val.length > 0 && val.every((v) => typeof v === "number" && Number.isFinite(v)))
  ) {
    // Encode as the pgvector text literal format `[0.1,0.2,...]`. JSON
    // stringify produces exactly that for a number array.
    const arr = val instanceof Float32Array ? Array.from(val) : (val as number[]);
    params.push(JSON.stringify(arr));
    return `$${params.length}::vector`;
  }
  params.push(val);
  return `$${params.length}`;
}

// ── SQL generation helpers ───────────────────────────────────────────

/**
 * Translate a Supabase `or()` expression (e.g. `title.ilike.%q%,compiled_truth.ilike.%q%`)
 * into a SQL expression, appending values to the params array.
 */
function translateOrExpr(expr: string, params: unknown[], paramOffset = 0): string {
  const clauses = expr.split(",").map((c) => c.trim()).filter(Boolean);
  const parts: string[] = [];
  const placeholder = () => `$${paramOffset + params.length}`;
  for (const clause of clauses) {
    // clause format: column.op.value  (value may contain `%` for ilike patterns)
    const firstDot = clause.indexOf(".");
    if (firstDot === -1) continue;
    const col = clause.slice(0, firstDot);
    const rest = clause.slice(firstDot + 1);
    const secondDot = rest.indexOf(".");
    if (secondDot === -1) continue;
    const op = rest.slice(0, secondDot);
    const value = rest.slice(secondDot + 1);

    switch (op) {
      case "ilike":
        params.push(value);
        parts.push(`${columnExpr(col)} ILIKE ${placeholder()}`);
        break;
      case "eq":
        params.push(value);
        parts.push(`${columnExpr(col)} = ${placeholder()}`);
        break;
      default:
        // Unknown op — skip rather than crash
        break;
    }
  }
  return parts.length > 0 ? parts.join(" OR ") : "FALSE";
}

/**
 * Build an INSERT or INSERT ... ON CONFLICT statement for a batch of rows.
 * Handles JSONB encoding by stringifying plain object values.
 */
function buildInsertSql(
  table: string,
  rows: any[],
  onConflict: string | null,
  returnSelect: string | null,
): { sql: string; params: unknown[] } {
  // Collect union of keys across rows so all rows have the same column list
  const keySet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keySet.add(key);
  }
  const keys = Array.from(keySet);
  const params: unknown[] = [];
  const valueTuples: string[] = [];

  for (const row of rows) {
    const placeholders: string[] = [];
    for (const key of keys) {
      // Use renderValuePlaceholder so vector(N) columns get the ::vector
      // cast — same fix as executeUpdate. encodeValue handles JSONB
      // stringification for non-vector object values.
      const raw = row[key];
      if (
        raw instanceof Float32Array ||
        (Array.isArray(raw) && raw.length > 0 && raw.every((v) => typeof v === "number" && Number.isFinite(v)))
      ) {
        placeholders.push(renderValuePlaceholder(raw, params));
      } else {
        params.push(encodeValue(raw));
        placeholders.push(`$${params.length}`);
      }
    }
    valueTuples.push(`(${placeholders.join(", ")})`);
  }

  const colList = keys.map((k) => quoteIdent(k)).join(", ");
  let sql = `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${valueTuples.join(", ")}`;

  if (onConflict) {
    const updates = keys
      .filter((k) => !onConflict.split(",").map((c) => c.trim()).includes(k))
      .map((k) => `${quoteIdent(k)} = EXCLUDED.${quoteIdent(k)}`)
      .join(", ");
    sql += ` ${onConflictClause(onConflict)}`;
    sql += updates ? ` DO UPDATE SET ${updates}` : " DO NOTHING";
  }

  sql += ` RETURNING ${returnSelect ? selectExpr(returnSelect) : "*"}`;

  return { sql, params };
}

/**
 * Encode a JS value for PGlite. Plain objects and arrays become JSON strings
 * so they can be stored in JSONB columns. Dates become ISO strings.
 */
function encodeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

// ── Client ───────────────────────────────────────────────────────────

export interface LocalUser {
  id: string;
  email: string;
}

const LOCAL_USER: LocalUser = {
  id: "local",
  email: "local@workflow-miner.app",
};

interface AuthStub {
  getUser(): Promise<{
    data: { user: LocalUser };
    error: null;
  }>;
  signOut(): Promise<{ error: null }>;
  signInWithPassword(_: unknown): Promise<{ data: null; error: null }>;
  signUp(_: unknown): Promise<{ data: null; error: null }>;
  signInWithOAuth(_: unknown): Promise<{ data: null; error: null }>;
  exchangeCodeForSession(_: unknown): Promise<{ data: null; error: null }>;
}

const authStub: AuthStub = {
  async getUser() {
    return { data: { user: LOCAL_USER }, error: null };
  },
  async signOut() {
    return { error: null };
  },
  async signInWithPassword() {
    return { data: null, error: null };
  },
  async signUp() {
    return { data: null, error: null };
  },
  async signInWithOAuth() {
    return { data: null, error: null };
  },
  async exchangeCodeForSession() {
    return { data: null, error: null };
  },
};

export interface LocalShimClient {
  from<T = any>(table: string): QueryBuilder<T>;
  rpc<T = any>(
    name: string,
    params?: Record<string, unknown>,
  ): Promise<ShimResult<T[]>>;
  auth: AuthStub;
}

/**
 * Format a numeric array as a pgvector text literal: `[0.1,0.2,...]`.
 * Returns null for any non-array input so the caller can short-circuit.
 */
function formatVectorLiteral(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  // pgvector accepts the JSON-array text form when cast with ::vector.
  // Numbers are stringified by JSON.stringify with full precision; bigint
  // is rejected upstream so we only need to guard against non-numeric.
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  return JSON.stringify(value);
}

/**
 * Implement a known RPC by translating the params into raw SQL against the
 * PGlite database. Only the RPCs the codebase actually calls are supported;
 * everything else returns a "function does not exist" error matching the
 * Postgres error code 42883 that the cloud Supabase would emit.
 *
 * Supported:
 *   - match_timeline_entries(query_embedding, match_threshold, match_count)
 *   - match_brain_pages(query_embedding, match_threshold, match_count)
 *
 * Both use cosine distance via `<=>`; the SQL mirrors the bodies in
 * `packages/engine/src/brain/schema.sql`.
 */
async function executeRpc<T>(
  db: Promise<PGliteInstance>,
  name: string,
  params: Record<string, unknown> | undefined,
): Promise<ShimResult<T[]>> {
  const args = params ?? {};

  if (name === "match_timeline_entries" || name === "match_brain_pages") {
    const literal = formatVectorLiteral(args.query_embedding);
    if (!literal) {
      return {
        data: null,
        error: {
          message: `${name}: query_embedding must be a numeric array`,
          code: "22023",
        },
      };
    }

    const threshold =
      typeof args.match_threshold === "number" ? args.match_threshold : 0.7;
    const count =
      typeof args.match_count === "number" ? args.match_count : 10;

    let sql: string;
    if (name === "match_timeline_entries") {
      sql = `
        SELECT
          bt.id,
          bt.page_id,
          bt.date,
          bt.source,
          bt.summary,
          bt.detail,
          1 - (bt.embedding <=> $1::vector) AS similarity
        FROM brain_timeline bt
        WHERE bt.embedding IS NOT NULL
          AND 1 - (bt.embedding <=> $1::vector) > $2
        ORDER BY bt.embedding <=> $1::vector ASC
        LIMIT $3
      `;
    } else {
      sql = `
        SELECT
          bp.id,
          bp.slug,
          bp.title,
          bp.type,
          bp.compiled_truth,
          1 - (bp.embedding <=> $1::vector) AS similarity
        FROM brain_pages bp
        WHERE bp.embedding IS NOT NULL
          AND 1 - (bp.embedding <=> $1::vector) > $2
        ORDER BY bp.embedding <=> $1::vector ASC
        LIMIT $3
      `;
    }

    try {
      const conn = await db;
      const result = await conn.query<T>(sql, [literal, threshold, count]);
      return { data: result.rows as T[], error: null };
    } catch (err) {
      const message = describeError(err);
      return { data: null, error: { message } };
    }
  }

  return {
    data: null,
    error: {
      message: `function ${name}() does not exist in local-shim`,
      code: "42883",
    },
  };
}

/**
 * Create a Supabase-compatible local client backed by PGlite.
 * Safe to call many times — the underlying database is a module-level
 * singleton initialized lazily on the first query.
 */
export function createLocalShimClient(): LocalShimClient {
  const db = getDb();
  return {
    from<T = any>(table: string) {
      return new QueryBuilder<T>(table, db);
    },
    rpc<T = any>(name: string, params?: Record<string, unknown>) {
      return executeRpc<T>(db, name, params);
    },
    auth: authStub,
  };
}

/**
 * Check whether the current process should use the local shim instead of a
 * real Supabase client. This is the single switch consumed by the
 * `lib/supabase/server.ts` and `lib/supabase/admin.ts` factories.
 */
export function isDesktopMode(): boolean {
  return process.env.WORKFLOW_MINER_MODE === "desktop";
}
