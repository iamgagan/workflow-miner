import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".workflow-miner");
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "data.db");

export interface DatabaseClientOptions {
  dbPath?: string;
  /** Use :memory: for testing */
  inMemory?: boolean;
}

interface MigrationRow {
  version: number;
}

export class DatabaseClient {
  private db: Database.Database;
  readonly dbPath: string;

  constructor(options: DatabaseClientOptions = {}) {
    if (options.inMemory) {
      this.dbPath = ":memory:";
      this.db = new Database(":memory:");
    } else {
      this.dbPath = options.dbPath ?? DEFAULT_DB_PATH;
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(this.dbPath);
    }

    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  get raw(): Database.Database {
    return this.db;
  }

  runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const applied = new Set(
      this.db
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => (row as MigrationRow).version)
    );

    const migrationsDir = path.join(__dirname, "migrations");
    if (!fs.existsSync(migrationsDir)) {
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) continue;

      const version = parseInt(match[1], 10);
      const name = match[2];

      if (applied.has(version)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

      const runInTransaction = this.db.transaction(() => {
        this.db.exec(sql);
        this.db
          .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
          .run(version, name);
      });
      runInTransaction();
    }
  }

  close(): void {
    this.db.close();
  }
}

let defaultClient: DatabaseClient | null = null;
let defaultClientOptions: DatabaseClientOptions | undefined;

export function getDefaultClient(
  options?: DatabaseClientOptions
): DatabaseClient {
  if (!defaultClient) {
    defaultClient = new DatabaseClient(options);
    defaultClientOptions = options;
    defaultClient.runMigrations();
  } else if (options !== undefined && defaultClientOptions !== undefined) {
    const currentPath = defaultClientOptions.dbPath ?? (defaultClientOptions.inMemory ? ":memory:" : undefined);
    const requestedPath = options.dbPath ?? (options.inMemory ? ":memory:" : undefined);
    if (currentPath !== requestedPath) {
      console.warn(
        `Warning: getDefaultClient called with different options (requested: ${requestedPath}, current: ${currentPath}). Returning existing client.`
      );
    }
  }
  return defaultClient;
}

export function resetDefaultClient(): void {
  if (defaultClient) {
    defaultClient.close();
    defaultClient = null;
    defaultClientOptions = undefined;
  }
}
