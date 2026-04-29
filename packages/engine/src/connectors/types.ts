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
  /**
   * Yields pages of raw events as they are fetched from the upstream API.
   * Each yielded array is a complete batch; consumers should treat pages as
   * units to normalize and persist incrementally so memory usage stays bounded.
   * Implementations validate credentials on first iteration and may throw
   * during iteration on transport or auth failures.
   */
  fetchEvents(config: ConnectorConfig): AsyncIterable<readonly RawEvent[]>;
}

/**
 * Drain a connector's page stream into a single flat array of raw events.
 * Useful in tests and for callers that don't need streaming semantics.
 */
export async function getAllEvents(
  connector: ConnectorInterface,
  config: ConnectorConfig,
): Promise<readonly RawEvent[]> {
  const out: RawEvent[] = [];
  for await (const page of connector.fetchEvents(config)) {
    out.push(...page);
  }
  return out;
}
