import type Database from "better-sqlite3";
import { EventRepository, type EventRow } from "../db/repositories/event-repository.js";
import { PatternRepository } from "../db/repositories/pattern-repository.js";
import { Sessionizer } from "../mining/sessionizer.js";
import { PatternMiner } from "../mining/pattern-miner.js";
import {
  PatternScorer,
  type ScoredPattern,
  type PatternCandidate,
  type PatternInstance,
} from "../mining/scorer.js";
import type { SessionSequence, Pattern } from "../mining/types.js";
import type { EventType } from "../normalize/schema.js";

export interface ReportPipelineOptions {
  /** ISO date string — only include events after this timestamp */
  readonly since?: string;
  /** Minimum composite score to include (default: 0) */
  readonly minScore?: number;
  /** Maximum number of patterns to return (default: 20) */
  readonly top?: number;
}

export interface ReportPipelineResult {
  readonly patterns: readonly ScoredPattern[];
  readonly totalEvents: number;
  readonly totalSessions: number;
  readonly totalMinedPatterns: number;
}

/**
 * Run the full report pipeline: load events → sessionize → mine → score → persist.
 */
export function runReportPipeline(
  db: Database.Database,
  options: ReportPipelineOptions = {},
): ReportPipelineResult {
  const emptyResult = (events = 0, sessions = 0): ReportPipelineResult => ({
    patterns: [],
    totalEvents: events,
    totalSessions: sessions,
    totalMinedPatterns: 0,
  });

  // 1. Load events
  const eventRepo = new EventRepository(db);
  const events = eventRepo.query({
    ...(options.since ? { after: options.since } : {}),
    limit: 100_000,
  });

  if (events.length === 0) return emptyResult();

  // 2. Sessionize
  const sessionizer = new Sessionizer();
  const sessions = sessionizer.groupEvents(events);

  if (sessions.length === 0) return emptyResult(events.length);

  // 3. Build SessionSequences from sessions + event lookup
  const eventMap = new Map<string, EventRow>();
  for (const e of events) {
    eventMap.set(e.event_id, e);
  }

  const sequences: SessionSequence[] = sessions.map((session) => ({
    sessionId: session.sessionId,
    events: session.eventIds
      .map((id) => eventMap.get(id))
      .filter((e): e is EventRow => e !== undefined)
      .map((e) => ({
        eventType: e.event_type,
        timestamp: e.timestamp,
        sourceSystem: e.source_system,
        actorId: e.actor_id,
      })),
  }));

  // 4. Mine patterns (minSupport 2 to catch smaller workflows)
  const miner = new PatternMiner({ minSupport: 2 });
  const minedPatterns = miner.mine(sequences);

  if (minedPatterns.length === 0) {
    return emptyResult(events.length, sessions.length);
  }

  // 5. Convert to PatternCandidates for the scorer
  const candidates = minedPatterns.map((pattern) =>
    patternToCandidate(pattern, sequences),
  );

  // 6. Score
  const scorer = new PatternScorer();
  let scored: readonly ScoredPattern[] = scorer.scoreAll(candidates);

  // 7. Filter by minScore
  const minScore = options.minScore ?? 0;
  if (minScore > 0) {
    scored = scored.filter((p) => p.compositeScore >= minScore);
  }

  // 8. Limit to top N
  const top = options.top ?? 20;
  scored = scored.slice(0, top);

  // 9. Persist to DB (upsert by content-hashed ID)
  const patternRepo = new PatternRepository(db);
  for (const sp of scored) {
    const mined = minedPatterns.find((p) => p.id === sp.patternId) ?? null;
    persistScoredPattern(patternRepo, db, sp, mined);
  }

  return {
    patterns: scored,
    totalEvents: events.length,
    totalSessions: sessions.length,
    totalMinedPatterns: minedPatterns.length,
  };
}

/**
 * Convert a mined Pattern into a PatternCandidate for the scorer.
 * Scans all sessions to build instance data.
 */
function patternToCandidate(
  pattern: Pattern,
  sequences: readonly SessionSequence[],
): PatternCandidate {
  const stepTypes = pattern.steps.map((s) => s.eventType as EventType);
  const instances: PatternInstance[] = [];

  for (const seq of sequences) {
    const seqTypes = seq.events.map((e) => e.eventType);
    if (isSubsequence(stepTypes, seqTypes)) {
      instances.push({ eventTypes: stepTypes, completed: true });
    }
  }

  return {
    id: pattern.id,
    name: pattern.name,
    steps: stepTypes,
    instances,
  };
}

/** Check if `needle` appears as a subsequence within `haystack`. */
function isSubsequence(
  needle: readonly string[],
  haystack: readonly string[],
): boolean {
  let ni = 0;
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
    if (haystack[hi] === needle[ni]) ni++;
  }
  return ni === needle.length;
}

/** Upsert a scored pattern into the patterns table. */
function persistScoredPattern(
  repo: PatternRepository,
  db: Database.Database,
  scored: ScoredPattern,
  mined: Pattern | null,
): void {
  const metadata = JSON.stringify({
    compositeScore: scored.compositeScore,
    breakdown: scored.breakdown,
  });

  const existing = repo.findById(scored.patternId);

  if (existing) {
    repo.updateFrequency(
      scored.patternId,
      mined?.support ?? existing.frequency,
      mined?.confidence ?? existing.confidence,
    );
    db.prepare(
      `UPDATE patterns SET metadata = ?, updated_at = datetime('now') WHERE pattern_id = ?`,
    ).run(metadata, scored.patternId);
  } else {
    repo.insert({
      pattern_id: scored.patternId,
      name: scored.name,
      frequency: mined?.support ?? 0,
      confidence: mined?.confidence ?? 0,
      avg_duration_ms: mined?.avgDurationMs ?? null,
      metadata,
      events: mined?.steps.map((s) => ({
        event_type: s.eventType,
        position: s.position,
        source_system: s.sourceSystem,
      })),
    });
  }
}
