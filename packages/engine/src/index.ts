// @workflow-miner/engine — public API

// Mining
export {
  PatternScorer,
  type PatternCandidate,
  type PatternInstance,
  type ScoredPattern,
  type ScoreBreakdown,
  type ScoringWeights,
} from "./mining/scorer.js";
export { Sessionizer } from "./mining/sessionizer.js";
export type { SessionizerOptions, Session } from "./mining/sessionizer.js";
export { PatternMiner } from "./mining/pattern-miner.js";
export type {
  MiningConfig,
  MinedCandidate,
  Pattern,
  PatternStep,
  SessionEvent,
  SessionSequence,
} from "./mining/types.js";

// Normalize
export { EventType, EntityType } from "./normalize/schema.js";
export type { Entity, NormalizedEvent } from "./normalize/schema.js";

// Connectors
export type {
  RawEvent,
  RawParticipant,
  ConnectorConfig,
  ConnectorInterface,
} from "./connectors/types.js";

// Config
export type {
  Config,
  GmailConfig,
  SlackConfig,
  LinearConfig,
  CalendarConfig,
  EmailConfig,
} from "./config/schema.js";
