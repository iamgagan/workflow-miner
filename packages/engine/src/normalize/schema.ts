export enum EventType {
  MessageSent = "message_sent",
  MessageReceived = "message_received",
  DecisionMade = "decision_made",
  IssueCreated = "issue_created",
  IssueUpdated = "issue_updated",
  MeetingScheduled = "meeting_scheduled",
  MeetingHeld = "meeting_held",
  MeetingCancelled = "meeting_cancelled",
  FollowupAssigned = "followup_assigned",
  ArtifactShared = "artifact_shared",
}

const MECHANICAL_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  EventType.MessageSent,
  EventType.MessageReceived,
  EventType.IssueCreated,
  EventType.IssueUpdated,
  EventType.FollowupAssigned,
  EventType.ArtifactShared,
]);

/**
 * True for event types that represent mechanical, low-decision actions
 * (e.g. sending a message, opening an issue) and are therefore good
 * automation candidates. Decisions and meetings are not mechanical.
 */
export function isMechanicalEventType(type: string): boolean {
  return MECHANICAL_EVENT_TYPES.has(type);
}

export enum EntityType {
  Person = "person",
  Thread = "thread",
  Channel = "channel",
  Issue = "issue",
  Meeting = "meeting",
  Artifact = "artifact",
}

export interface Entity {
  readonly id: string;
  readonly type: EntityType;
  readonly name: string;
  /** Maps source name → source-specific ID for cross-source resolution */
  readonly sourceIds: Readonly<Record<string, string>>;
}

export interface NormalizedEvent {
  readonly id: string;
  readonly type: EventType;
  readonly timestamp: Date;
  readonly source: string;
  readonly entities: readonly Entity[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly rawEventId: string;
}
