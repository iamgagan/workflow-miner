import crypto from "node:crypto";
import type { RawEvent } from "../connectors/types.js";
import {
  type Entity,
  EntityType,
  EventType,
  type NormalizedEvent,
} from "./schema.js";
import { EntityResolver } from "./entity-resolver.js";

export interface NormalizeResult {
  readonly events: readonly NormalizedEvent[];
  readonly errors: readonly NormalizeError[];
}

export interface NormalizeError {
  readonly rawEventId: string;
  readonly message: string;
}

const EVENT_TYPE_MAP: Readonly<Record<string, EventType>> = {
  message_sent: EventType.MessageSent,
  message_received: EventType.MessageReceived,
  decision_made: EventType.DecisionMade,
  issue_created: EventType.IssueCreated,
  issue_updated: EventType.IssueUpdated,
  meeting_scheduled: EventType.MeetingScheduled,
  meeting_held: EventType.MeetingHeld,
  meeting_cancelled: EventType.MeetingCancelled,
  followup_assigned: EventType.FollowupAssigned,
  artifact_shared: EventType.ArtifactShared,
};

const PARTICIPANT_TYPE_MAP: Readonly<Record<string, EntityType>> = {
  person: EntityType.Person,
  thread: EntityType.Thread,
  channel: EntityType.Channel,
  issue: EntityType.Issue,
  meeting: EntityType.Meeting,
  artifact: EntityType.Artifact,
  organizer: EntityType.Person,
  self: EntityType.Person,
  attendee: EntityType.Person,
};

function deterministicId(rawEventId: string): string {
  return crypto.createHash("sha256").update(rawEventId).digest("hex").slice(0, 32);
}

function resolveEventType(rawType: string): EventType {
  const mapped = EVENT_TYPE_MAP[rawType];
  if (mapped === undefined) {
    throw new Error(`Unknown event type: "${rawType}"`);
  }
  return mapped;
}

function resolveEntityType(rawType: string): EntityType {
  const mapped = PARTICIPANT_TYPE_MAP[rawType];
  if (mapped === undefined) {
    throw new Error(`Unknown entity type: "${rawType}"`);
  }
  return mapped;
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp: "${value}"`);
  }
  return parsed;
}

export class Normalizer {
  private readonly entityResolver: EntityResolver;

  constructor(entityResolver?: EntityResolver) {
    this.entityResolver = entityResolver ?? new EntityResolver();
  }

  normalize(rawEvents: readonly RawEvent[]): NormalizeResult {
    const events: NormalizedEvent[] = [];
    const errors: NormalizeError[] = [];

    for (const raw of rawEvents) {
      try {
        events.push(this.normalizeOne(raw));
      } catch (err) {
        errors.push({
          rawEventId: raw.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { events, errors };
  }

  private normalizeOne(raw: RawEvent): NormalizedEvent {
    const entities: readonly Entity[] = raw.participants.map((p) => {
      const entity: Entity = {
        id: deterministicId(`${raw.source}:${p.id}`),
        type: resolveEntityType(p.type),
        name: p.name,
        sourceIds: { [raw.source]: p.id },
      };
      return this.entityResolver.resolve(entity);
    });

    return {
      id: deterministicId(raw.id),
      type: resolveEventType(raw.type),
      timestamp: toDate(raw.timestamp),
      source: raw.source,
      entities,
      metadata: raw.data,
      rawEventId: raw.id,
    };
  }
}
