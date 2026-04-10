/**
 * A single step in a discovered pattern — an event type at a specific position.
 */
export interface PatternStep {
  readonly eventType: string;
  readonly position: number;
  /** Optional source system constraint (null = any source) */
  readonly sourceSystem: string | null;
}

/**
 * A candidate pattern found during mining, before final filtering.
 */
export interface MinedCandidate {
  readonly steps: readonly PatternStep[];
  /** Session IDs where this pattern was observed */
  readonly supportingSessions: readonly string[];
  /** Number of sessions containing this pattern */
  readonly support: number;
}

/**
 * A confirmed pattern that met the minimum support threshold.
 */
export interface Pattern {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly PatternStep[];
  readonly support: number;
  /** Fraction of sessions containing this pattern */
  readonly confidence: number;
  readonly exampleSessions: readonly string[];
  /** Average time span (ms) from first to last step across supporting sessions */
  readonly avgDurationMs: number | null;
}

/**
 * A sessionized sequence of events ready for mining.
 * Each session is a time-ordered list of event types (with metadata).
 */
export interface SessionSequence {
  readonly sessionId: string;
  readonly events: readonly SessionEvent[];
}

/**
 * A single event within a session, carrying just enough data for mining.
 */
export interface SessionEvent {
  readonly eventType: string;
  readonly timestamp: string;
  readonly sourceSystem: string;
  readonly actorId: string;
}

/**
 * Configuration for the pattern mining algorithm.
 */
export interface MiningConfig {
  /** Minimum number of sessions a pattern must appear in (default: 3) */
  readonly minSupport: number;
  /** Maximum pattern length to search for (default: 10) */
  readonly maxPatternLength: number;
  /** Whether to treat different source systems as distinct steps (default: false) */
  readonly sourceAware: boolean;
}
