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
 */
const BRAIN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS brain_pages (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'concept',
  title TEXT NOT NULL,
  compiled_truth TEXT DEFAULT '',
  timeline TEXT DEFAULT '',
  frontmatter JSONB DEFAULT '{}'::jsonb,
  content_hash TEXT,
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
];

function isWasmCrash(message: string): boolean {
  return WASM_CRASH_PATTERNS.some((p) => message.includes(p));
}

async function bootDb(): Promise<PGliteInstance> {
  const dataDir = resolveDataDir();
  await fs.mkdir(dataDir, { recursive: true });

  // Lazy import so PGlite stays out of non-desktop bundles
  const { PGlite } = (await import("@electric-sql/pglite")) as {
    PGlite: new (dataDir?: string) => PGliteInstance;
  };

  let db: PGliteInstance;
  try {
    db = new PGlite(dataDir);

    // Wait for the WASM Postgres engine to finish booting before issuing any
    // SQL.  PGlite 0.2.x exposes `waitReady` as a Promise that resolves once
    // the internal Emscripten module is fully initialised; the constructor
    // kicks off the async init internally but `exec`/`query` are NOT
    // guaranteed to wait for it.
    if (db.waitReady) await db.waitReady;

    await db.exec(BRAIN_SCHEMA_SQL);
    return db;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // If the WASM module crashed with a persistent-storage database, fall
    // back to an ephemeral in-memory instance so the app remains usable.
    if (isWasmCrash(message)) {
      console.warn(
        `[local-shim] PGlite WASM crashed with persistent storage (${dataDir}), retrying in-memory…`,
      );
      const memDb = new PGlite();
      if (memDb.waitReady) await memDb.waitReady;
      await memDb.exec(BRAIN_SCHEMA_SQL);
      return memDb;
    }
    throw err;
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
  | { kind: "or"; expr: string };

interface QueryState {
  readonly table: string;
  op: "select" | "insert" | "upsert" | "delete";
  columns: string;
  filters: Filter[];
  orderBy: { col: string; ascending: boolean } | null;
  limit: number | null;
  insertRows: any[];
  upsertOnConflict: string | null;
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
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

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

  private buildWhere(): { sql: string; params: unknown[] } {
    if (this.state.filters.length === 0) return { sql: "", params: [] };
    const parts: string[] = [];
    const params: unknown[] = [];

    for (const f of this.state.filters) {
      switch (f.kind) {
        case "eq":
          params.push(f.val);
          parts.push(`${columnExpr(f.col)} = $${params.length}`);
          break;
        case "gte":
          params.push(f.val);
          parts.push(`${columnExpr(f.col)} >= $${params.length}`);
          break;
        case "lt":
          params.push(f.val);
          parts.push(`${columnExpr(f.col)} < $${params.length}`);
          break;
        case "in": {
          if (f.vals.length === 0) {
            parts.push("FALSE");
            break;
          }
          const placeholders: string[] = [];
          for (const v of f.vals) {
            params.push(v);
            placeholders.push(`$${params.length}`);
          }
          parts.push(`${columnExpr(f.col)} IN (${placeholders.join(", ")})`);
          break;
        }
        case "or": {
          // Translate Supabase's or("a.ilike.x,b.ilike.y") → (a ILIKE x OR b ILIKE y)
          parts.push(`(${translateOrExpr(f.expr, params)})`);
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
}

// ── SQL generation helpers ───────────────────────────────────────────

/**
 * Translate a Supabase `or()` expression (e.g. `title.ilike.%q%,compiled_truth.ilike.%q%`)
 * into a SQL expression, appending values to the params array.
 */
function translateOrExpr(expr: string, params: unknown[]): string {
  const clauses = expr.split(",").map((c) => c.trim()).filter(Boolean);
  const parts: string[] = [];
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
        parts.push(`${columnExpr(col)} ILIKE $${params.length}`);
        break;
      case "eq":
        params.push(value);
        parts.push(`${columnExpr(col)} = $${params.length}`);
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
      const val = encodeValue(row[key]);
      params.push(val);
      placeholders.push(`$${params.length}`);
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
  auth: AuthStub;
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
