import type Database from "better-sqlite3";

export interface PatternRow {
  pattern_id: string;
  name: string;
  description: string | null;
  frequency: number;
  confidence: number;
  avg_duration_ms: number | null;
  source_systems: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface PatternEventRow {
  id: number;
  pattern_id: string;
  event_type: string;
  position: number;
  source_system: string | null;
  metadata: string;
}

export interface InsertPattern {
  pattern_id: string;
  name: string;
  description?: string | null;
  frequency?: number;
  confidence?: number;
  avg_duration_ms?: number | null;
  source_systems?: string;
  metadata?: string;
  events?: Array<{
    event_type: string;
    position: number;
    source_system?: string | null;
    metadata?: string;
  }>;
}

export interface PatternQuery {
  min_frequency?: number;
  min_confidence?: number;
  limit?: number;
  offset?: number;
  order_by?: "frequency" | "confidence" | "created_at";
}

const ALLOWED_ORDER_BY_COLUMNS = new Set(["frequency", "confidence", "created_at"]);

export class PatternRepository {
  private insertPatternStmt: Database.Statement;
  private insertEventStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertPatternStmt = this.db.prepare(`
      INSERT INTO patterns (
        pattern_id, name, description, frequency, confidence,
        avg_duration_ms, source_systems, metadata
      ) VALUES (
        @pattern_id, @name, @description, @frequency, @confidence,
        @avg_duration_ms, @source_systems, @metadata
      )
    `);

    this.insertEventStmt = this.db.prepare(`
      INSERT INTO pattern_events (pattern_id, event_type, position, source_system, metadata)
      VALUES (@pattern_id, @event_type, @position, @source_system, @metadata)
    `);
  }

  insert(pattern: InsertPattern): void {
    const tx = this.db.transaction(() => {
      this.insertPatternStmt.run({
        pattern_id: pattern.pattern_id,
        name: pattern.name,
        description: pattern.description ?? null,
        frequency: pattern.frequency ?? 0,
        confidence: pattern.confidence ?? 0.0,
        avg_duration_ms: pattern.avg_duration_ms ?? null,
        source_systems: pattern.source_systems ?? "[]",
        metadata: pattern.metadata ?? "{}",
      });

      if (pattern.events) {
        for (const event of pattern.events) {
          this.insertEventStmt.run({
            pattern_id: pattern.pattern_id,
            event_type: event.event_type,
            position: event.position,
            source_system: event.source_system ?? null,
            metadata: event.metadata ?? "{}",
          });
        }
      }
    });
    tx();
  }

  findById(patternId: string): PatternRow | undefined {
    return this.db
      .prepare("SELECT * FROM patterns WHERE pattern_id = ?")
      .get(patternId) as PatternRow | undefined;
  }

  findEvents(patternId: string): PatternEventRow[] {
    return this.db
      .prepare(
        "SELECT * FROM pattern_events WHERE pattern_id = ? ORDER BY position ASC"
      )
      .all(patternId) as PatternEventRow[];
  }

  query(params: PatternQuery = {}): PatternRow[] {
    const conditions: string[] = [];
    const values: Record<string, unknown> = {};

    if (params.min_frequency !== undefined) {
      conditions.push("frequency >= @min_frequency");
      values.min_frequency = params.min_frequency;
    }
    if (params.min_confidence !== undefined) {
      conditions.push("confidence >= @min_confidence");
      values.min_confidence = params.min_confidence;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = params.order_by ?? "frequency";
    if (!ALLOWED_ORDER_BY_COLUMNS.has(orderBy)) {
      throw new Error(`Invalid order_by column: ${orderBy}`);
    }
    const orderDir = orderBy === "created_at" ? "ASC" : "DESC";
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    return this.db
      .prepare(
        `SELECT * FROM patterns ${where} ORDER BY ${orderBy} ${orderDir} LIMIT @limit OFFSET @offset`
      )
      .all({ ...values, limit, offset }) as PatternRow[];
  }

  updateFrequency(
    patternId: string,
    frequency: number,
    confidence: number
  ): void {
    this.db
      .prepare(
        `UPDATE patterns SET frequency = ?, confidence = ?, updated_at = datetime('now') WHERE pattern_id = ?`
      )
      .run(frequency, confidence, patternId);
  }
}
