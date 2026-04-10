export interface RawEvent {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly timestamp: string | Date;
  readonly participants: readonly RawParticipant[];
  readonly data: Readonly<Record<string, unknown>>;
}

export interface RawParticipant {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface ConnectorConfig {
  readonly credentials: Readonly<Record<string, string>>;
  readonly lookbackDays: number;
}

export interface ConnectorInterface {
  readonly source: string;
  fetchEvents(config: ConnectorConfig): Promise<readonly RawEvent[]>;
}
