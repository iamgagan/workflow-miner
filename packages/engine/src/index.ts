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
export { Normalizer } from "./normalize/normalizer.js";
export type { NormalizeResult, NormalizeError } from "./normalize/normalizer.js";
export { EventType, EntityType } from "./normalize/schema.js";
export type { Entity, NormalizedEvent } from "./normalize/schema.js";

// Brain
export { IngestWriter } from "./brain/ingest-writer.js";
export type { WriteResult } from "./brain/ingest-writer.js";
export type { BrainClient } from "./brain/client.js";
export type {
  BrainPage,
  BrainLink,
  BrainStats,
  TimelineEntry,
  PageType,
} from "./brain/types.js";

// Connectors
export {
  CalendarConnector,
  GitHubConnector,
  GmailConnector,
  JiraConnector,
  LinearConnector,
  NotionConnector,
  OutlookConnector,
  SlackConnector,
} from "./connectors/index.js";
export type {
  RawEvent,
  RawParticipant,
  ConnectorConfig,
  ConnectorInterface,
} from "./connectors/types.js";

// Pipeline
export { runIngest } from "./pipeline/ingest.js";
export type {
  IngestOptions,
  IngestResult,
  IngestDependencies,
} from "./pipeline/ingest.js";

// Config
export type {
  Config,
  GmailConfig,
  SlackConfig,
  LinearConfig,
  CalendarConfig,
  EmailConfig,
} from "./config/schema.js";
