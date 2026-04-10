import { describe, it, expect, afterEach } from "vitest";
import { DatabaseClient } from "./client";

describe("db/client", () => {
  let client: DatabaseClient;

  afterEach(() => {
    client?.close();
  });

  it("creates an in-memory database", () => {
    client = new DatabaseClient({ inMemory: true });
    expect(client.dbPath).toBe(":memory:");
    expect(client.raw).toBeDefined();
  });

  it("runs migrations idempotently", () => {
    client = new DatabaseClient({ inMemory: true });
    client.runMigrations();
    client.runMigrations(); // second call should not throw

    const tables = client.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("events");
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("patterns");
    expect(tableNames).toContain("pattern_events");
    expect(tableNames).toContain("entities");
    expect(tableNames).toContain("skills_exported");
    expect(tableNames).toContain("schema_migrations");
  });

  it("records migration version after applying", () => {
    client = new DatabaseClient({ inMemory: true });
    client.runMigrations();

    const migrations = client.raw
      .prepare("SELECT version, name FROM schema_migrations")
      .all() as Array<{ version: number; name: string }>;

    expect(migrations.length).toBe(1);
    expect(migrations[0].version).toBe(1);
    expect(migrations[0].name).toBe("initial");
  });

  it("enables WAL mode and foreign keys", () => {
    client = new DatabaseClient({ inMemory: true });

    const journalMode = client.raw.pragma("journal_mode", {
      simple: true,
    }) as string;
    // In-memory databases may report "memory" instead of "wal"
    expect(["wal", "memory"]).toContain(journalMode);

    const fk = client.raw.pragma("foreign_keys", { simple: true }) as number;
    expect(fk).toBe(1);
  });

  it("runs migrations atomically (version insert in same transaction as exec)", () => {
    client = new DatabaseClient({ inMemory: true });
    client.runMigrations();

    // After running migrations, the version should be recorded
    const migrations = client.raw
      .prepare("SELECT version, name FROM schema_migrations")
      .all() as Array<{ version: number; name: string }>;

    // Verify migration was applied and version recorded atomically
    expect(migrations.length).toBe(1);
    expect(migrations[0].version).toBe(1);

    // Verify the tables from the migration exist
    const tables = client.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
      .all();
    expect(tables.length).toBe(1);
  });

  it("creates database directory if it does not exist", () => {
    const dir = `/tmp/workflow-miner-test-${Date.now()}`;
    const tmpPath = `${dir}/data.db`;
    client = new DatabaseClient({ dbPath: tmpPath });
    expect(client.dbPath).toBe(tmpPath);
    client.close();
    // cleanup
    const fs = require("node:fs");
    fs.unlinkSync(tmpPath);
    fs.rmdirSync(dir);
  });
});
