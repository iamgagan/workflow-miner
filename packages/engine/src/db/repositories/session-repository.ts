import type Database from "better-sqlite3";

export interface SessionRow {
  session_id: string;
  actor_id: string;
  start_time: string;
  end_time: string;
  event_count: number;
  source_systems: string;
  metadata: string;
  created_at: string;
}

export interface InsertSession {
  session_id: string;
  actor_id: string;
  start_time: string;
  end_time: string;
  event_count?: number;
  source_systems?: string;
  metadata?: string;
}

export interface SessionQuery {
  actor_id?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}

export class SessionRepository {
  private insertStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = this.db.prepare(`
      INSERT INTO sessions (
        session_id, actor_id, start_time, end_time,
        event_count, source_systems, metadata
      ) VALUES (
        @session_id, @actor_id, @start_time, @end_time,
        @event_count, @source_systems, @metadata
      )
    `);
  }

  insert(session: InsertSession): void {
    this.insertStmt.run({
      session_id: session.session_id,
      actor_id: session.actor_id,
      start_time: session.start_time,
      end_time: session.end_time,
      event_count: session.event_count ?? 0,
      source_systems: session.source_systems ?? "[]",
      metadata: session.metadata ?? "{}",
    });
  }

  insertMany(sessions: InsertSession[]): void {
    const tx = this.db.transaction((items: InsertSession[]) => {
      for (const session of items) {
        this.insert(session);
      }
    });
    tx(sessions);
  }

  findById(sessionId: string): SessionRow | undefined {
    return this.db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as SessionRow | undefined;
  }

  query(params: SessionQuery = {}): SessionRow[] {
    const conditions: string[] = [];
    const values: Record<string, unknown> = {};

    if (params.actor_id) {
      conditions.push("actor_id = @actor_id");
      values.actor_id = params.actor_id;
    }
    if (params.after) {
      conditions.push("start_time > @after");
      values.after = params.after;
    }
    if (params.before) {
      conditions.push("end_time < @before");
      values.before = params.before;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    return this.db
      .prepare(
        `SELECT * FROM sessions ${where} ORDER BY start_time ASC LIMIT @limit OFFSET @offset`
      )
      .all({ ...values, limit, offset }) as SessionRow[];
  }

  countByActor(): Record<string, number> {
    const rows = this.db
      .prepare(
        "SELECT actor_id, COUNT(*) as count FROM sessions GROUP BY actor_id"
      )
      .all() as Array<{ actor_id: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.actor_id] = row.count;
    }
    return result;
  }
}
