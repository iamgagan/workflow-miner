import type Database from "better-sqlite3";

export interface EventRow {
  event_id: string;
  source_system: string;
  source_object_type: string;
  source_object_id: string;
  actor_id: string;
  timestamp: string;
  workspace_id: string | null;
  conversation_id: string | null;
  entity_refs: string;
  event_type: string;
  content_text: string | null;
  metadata: string;
  parent_event_id: string | null;
  causal_links: string;
  confidence: number;
  pii_redaction_state: string;
  created_at: string;
}

export interface InsertEvent {
  event_id: string;
  source_system: string;
  source_object_type: string;
  source_object_id: string;
  actor_id: string;
  timestamp: string;
  workspace_id?: string | null;
  conversation_id?: string | null;
  entity_refs?: string;
  event_type: string;
  content_text?: string | null;
  metadata?: string;
  parent_event_id?: string | null;
  causal_links?: string;
  confidence?: number;
  pii_redaction_state?: string;
}

export interface EventQuery {
  source_system?: string;
  actor_id?: string;
  event_type?: string;
  workspace_id?: string;
  conversation_id?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}

export class EventRepository {
  private insertStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        event_id, source_system, source_object_type, source_object_id,
        actor_id, timestamp, workspace_id, conversation_id,
        entity_refs, event_type, content_text, metadata,
        parent_event_id, causal_links, confidence, pii_redaction_state
      ) VALUES (
        @event_id, @source_system, @source_object_type, @source_object_id,
        @actor_id, @timestamp, @workspace_id, @conversation_id,
        @entity_refs, @event_type, @content_text, @metadata,
        @parent_event_id, @causal_links, @confidence, @pii_redaction_state
      )
    `);
  }

  insert(event: InsertEvent): void {
    this.insertStmt.run({
      event_id: event.event_id,
      source_system: event.source_system,
      source_object_type: event.source_object_type,
      source_object_id: event.source_object_id,
      actor_id: event.actor_id,
      timestamp: event.timestamp,
      workspace_id: event.workspace_id ?? null,
      conversation_id: event.conversation_id ?? null,
      entity_refs: event.entity_refs ?? "[]",
      event_type: event.event_type,
      content_text: event.content_text ?? null,
      metadata: event.metadata ?? "{}",
      parent_event_id: event.parent_event_id ?? null,
      causal_links: event.causal_links ?? "[]",
      confidence: event.confidence ?? 1.0,
      pii_redaction_state: event.pii_redaction_state ?? "none",
    });
  }

  insertMany(events: InsertEvent[]): void {
    const tx = this.db.transaction((items: InsertEvent[]) => {
      for (const event of items) {
        this.insert(event);
      }
    });
    tx(events);
  }

  findById(eventId: string): EventRow | undefined {
    return this.db
      .prepare("SELECT * FROM events WHERE event_id = ?")
      .get(eventId) as EventRow | undefined;
  }

  query(params: EventQuery = {}): EventRow[] {
    const conditions: string[] = [];
    const values: Record<string, unknown> = {};

    if (params.source_system) {
      conditions.push("source_system = @source_system");
      values.source_system = params.source_system;
    }
    if (params.actor_id) {
      conditions.push("actor_id = @actor_id");
      values.actor_id = params.actor_id;
    }
    if (params.event_type) {
      conditions.push("event_type = @event_type");
      values.event_type = params.event_type;
    }
    if (params.workspace_id) {
      conditions.push("workspace_id = @workspace_id");
      values.workspace_id = params.workspace_id;
    }
    if (params.conversation_id) {
      conditions.push("conversation_id = @conversation_id");
      values.conversation_id = params.conversation_id;
    }
    if (params.after) {
      conditions.push("timestamp > @after");
      values.after = params.after;
    }
    if (params.before) {
      conditions.push("timestamp < @before");
      values.before = params.before;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    return this.db
      .prepare(
        `SELECT * FROM events ${where} ORDER BY timestamp ASC LIMIT @limit OFFSET @offset`
      )
      .all({ ...values, limit, offset }) as EventRow[];
  }

  countBySource(): Record<string, number> {
    const rows = this.db
      .prepare(
        "SELECT source_system, COUNT(*) as count FROM events GROUP BY source_system"
      )
      .all() as Array<{ source_system: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.source_system] = row.count;
    }
    return result;
  }
}
