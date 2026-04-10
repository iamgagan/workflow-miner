import { createHash } from "node:crypto";
import type {
  MiningConfig,
  Pattern,
  MinedCandidate,
  PatternStep,
  SessionEvent,
  SessionSequence,
} from "./types.js";

const DEFAULT_CONFIG: MiningConfig = {
  minSupport: 3,
  maxPatternLength: 10,
  sourceAware: false,
};

/**
 * Mines frequent subsequences from sessionized event data.
 *
 * Uses a PrefixSpan-inspired approach:
 * 1. Find all frequent 1-item sequences (single event types).
 * 2. Recursively grow each prefix by one step, projecting sessions that
 *    contain the prefix and checking support of possible extensions.
 * 3. Stop when no extension meets minSupport or maxPatternLength is reached.
 */
export class PatternMiner {
  private readonly config: MiningConfig;

  constructor(config: Partial<MiningConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    if (merged.minSupport < 2) {
      throw new Error("minSupport must be >= 2");
    }
    this.config = merged;
  }

  /**
   * Run pattern mining on a set of session sequences.
   * Returns all patterns that meet the minimum support threshold,
   * sorted by support descending.
   */
  mine(sessions: readonly SessionSequence[]): readonly Pattern[] {
    if (sessions.length === 0) {
      return [];
    }

    // Build O(1) session lookup map
    const sessionIndex = new Map<string, number>();
    for (let i = 0; i < sessions.length; i++) {
      sessionIndex.set(sessions[i].sessionId, i);
    }

    const candidates = this.findFrequentSubsequences(sessions, sessionIndex);

    // Remove patterns that are strict sub-sequences of a longer pattern
    // with the same support (closed pattern pruning)
    const pruned = this.pruneSubsumed(candidates);

    return pruned
      .map((candidate) =>
        this.candidateToPattern(candidate, sessions, sessionIndex)
      )
      .sort((a, b) => b.support - a.support || b.steps.length - a.steps.length);
  }

  /**
   * PrefixSpan-style frequent subsequence discovery.
   */
  private findFrequentSubsequences(
    sessions: readonly SessionSequence[],
    sessionIndex: ReadonlyMap<string, number>
  ): readonly MinedCandidate[] {
    const results: MinedCandidate[] = [];

    // Extract item keys from each session (event type, optionally with source)
    const sessionItems = sessions.map((s) => this.sessionToKeys(s));

    // Find frequent 1-length items
    const freq1 = this.findFrequentItems(sessionItems, sessions);

    // Grow each frequent item into longer patterns
    for (const [itemKey, supportingSessions] of freq1) {
      const prefix: string[] = [itemKey];
      const step = this.keyToStep(itemKey, 0);

      this.growPrefix(
        prefix,
        [step],
        supportingSessions,
        sessionItems,
        sessionIndex,
        results
      );
    }

    return results;
  }

  /**
   * Recursively grow a prefix by one item, recording candidates that meet
   * min support along the way.
   */
  private growPrefix(
    prefix: readonly string[],
    steps: readonly PatternStep[],
    supportingSessionIds: readonly string[],
    sessionItems: readonly (readonly string[])[],
    sessionIndex: ReadonlyMap<string, number>,
    results: MinedCandidate[]
  ): void {
    // Record this prefix as a candidate (length >= 2 only — single-item
    // patterns are rarely meaningful workflows)
    if (prefix.length >= 2) {
      results.push({
        steps,
        supportingSessions: supportingSessionIds,
        support: supportingSessionIds.length,
      });
    }

    if (prefix.length >= this.config.maxPatternLength) {
      return;
    }

    // Build projected database: for each supporting session, collect items
    // that appear *after* the last prefix occurrence
    const extensions = new Map<string, Set<string>>();

    for (const sessionId of supportingSessionIds) {
      const idx = sessionIndex.get(sessionId);
      if (idx === undefined) continue;

      const items = sessionItems[idx];

      // Find the position after the last matched prefix item;
      // skip this session if it doesn't fully contain the prefix
      let searchFrom = 0;
      let prefixFullyMatched = true;
      for (const prefixItem of prefix) {
        const pos = items.indexOf(prefixItem, searchFrom);
        if (pos === -1) {
          prefixFullyMatched = false;
          break;
        }
        searchFrom = pos + 1;
      }

      if (!prefixFullyMatched) continue;

      // Collect distinct extensions from this session
      const seen = new Set<string>();
      for (let i = searchFrom; i < items.length; i++) {
        const item = items[i];
        if (!seen.has(item)) {
          seen.add(item);
          if (!extensions.has(item)) {
            extensions.set(item, new Set());
          }
          extensions.get(item)!.add(sessionId);
        }
      }
    }

    // Recurse into each extension that meets min support
    for (const [extKey, extSessions] of extensions) {
      if (extSessions.size >= this.config.minSupport) {
        const newPrefix = [...prefix, extKey];
        const newStep = this.keyToStep(extKey, prefix.length);
        const newSteps = [...steps, newStep];
        const newSessionIds = [...extSessions];

        this.growPrefix(
          newPrefix,
          newSteps,
          newSessionIds,
          sessionItems,
          sessionIndex,
          results
        );
      }
    }
  }

  /**
   * Find all items (event types) that appear in >= minSupport sessions.
   * Returns a map from item key to the list of session IDs containing it.
   */
  private findFrequentItems(
    sessionItems: readonly (readonly string[])[],
    sessions: readonly SessionSequence[]
  ): Map<string, string[]> {
    const itemSessions = new Map<string, Set<string>>();

    for (let i = 0; i < sessionItems.length; i++) {
      const seen = new Set<string>();
      for (const item of sessionItems[i]) {
        if (!seen.has(item)) {
          seen.add(item);
          if (!itemSessions.has(item)) {
            itemSessions.set(item, new Set());
          }
          itemSessions.get(item)!.add(sessions[i].sessionId);
        }
      }
    }

    const result = new Map<string, string[]>();
    for (const [item, sessionSet] of itemSessions) {
      if (sessionSet.size >= this.config.minSupport) {
        result.set(item, [...sessionSet]);
      }
    }
    return result;
  }

  /**
   * Convert a session's events to a list of string keys for mining.
   */
  private sessionToKeys(session: SessionSequence): readonly string[] {
    return session.events.map((e) => this.eventToKey(e));
  }

  /**
   * Create a string key for an event, optionally including source system.
   */
  private eventToKey(event: SessionEvent): string {
    if (this.config.sourceAware) {
      return `${event.eventType}@${event.sourceSystem}`;
    }
    return event.eventType;
  }

  /**
   * Convert an item key back to a PatternStep.
   */
  private keyToStep(key: string, position: number): PatternStep {
    if (this.config.sourceAware && key.includes("@")) {
      const [eventType, sourceSystem] = key.split("@", 2);
      return { eventType, position, sourceSystem };
    }
    return { eventType: key, position, sourceSystem: null };
  }

  /**
   * Remove candidate patterns that are strict subsequences of a longer
   * candidate with the same support count (closed pattern pruning).
   */
  private pruneSubsumed(
    candidates: readonly MinedCandidate[]
  ): readonly MinedCandidate[] {
    if (candidates.length === 0) return [];

    // Group by support count for efficient comparison
    const bySupport = new Map<number, MinedCandidate[]>();
    for (const c of candidates) {
      if (!bySupport.has(c.support)) {
        bySupport.set(c.support, []);
      }
      bySupport.get(c.support)!.push(c);
    }

    const result: MinedCandidate[] = [];

    for (const [, group] of bySupport) {
      // Sort longest first so we can check shorter against longer
      const sorted = [...group].sort(
        (a, b) => b.steps.length - a.steps.length
      );

      for (let i = 0; i < sorted.length; i++) {
        const candidate = sorted[i];
        let subsumed = false;

        for (let j = 0; j < i; j++) {
          if (this.isSubsequence(candidate.steps, sorted[j].steps)) {
            subsumed = true;
            break;
          }
        }

        if (!subsumed) {
          result.push(candidate);
        }
      }
    }

    return result;
  }

  /**
   * Check if `shorter` is a subsequence of `longer`.
   */
  private isSubsequence(
    shorter: readonly PatternStep[],
    longer: readonly PatternStep[]
  ): boolean {
    if (shorter.length >= longer.length) return false;

    let si = 0;
    for (let li = 0; li < longer.length && si < shorter.length; li++) {
      if (shorter[si].eventType === longer[li].eventType) {
        si++;
      }
    }
    return si === shorter.length;
  }

  /**
   * Generate a content-hash pattern ID from the step event types.
   */
  private generatePatternId(steps: readonly PatternStep[]): string {
    const content = steps.map((s) => s.eventType).join("|");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
    return `pattern-${hash}`;
  }

  /**
   * Convert a candidate to a final Pattern with computed metadata.
   */
  private candidateToPattern(
    candidate: MinedCandidate,
    sessions: readonly SessionSequence[],
    sessionIndex: ReadonlyMap<string, number>
  ): Pattern {
    const stepNames = candidate.steps.map((s) => s.eventType);
    const name = stepNames.join(" → ");

    const avgDurationMs = this.computeAvgDuration(candidate, sessions, sessionIndex);
    const totalSessions = sessions.length;

    return {
      id: this.generatePatternId(candidate.steps),
      name,
      steps: candidate.steps,
      support: candidate.support,
      confidence: totalSessions > 0 ? candidate.support / totalSessions : 0,
      exampleSessions: candidate.supportingSessions.slice(0, 5),
      avgDurationMs,
    };
  }

  /**
   * Compute the average duration (ms) from first to last step of a pattern
   * across its supporting sessions.
   */
  private computeAvgDuration(
    candidate: MinedCandidate,
    sessions: readonly SessionSequence[],
    sessionIndex: ReadonlyMap<string, number>
  ): number | null {
    if (candidate.steps.length < 2) return null;

    const durations: number[] = [];
    const stepTypes = candidate.steps.map((s) => s.eventType);

    for (const sessionId of candidate.supportingSessions) {
      const idx = sessionIndex.get(sessionId);
      if (idx === undefined) continue;

      const session = sessions[idx];
      const timestamps = this.findStepTimestamps(session.events, stepTypes);
      if (timestamps.length === stepTypes.length) {
        const first = new Date(timestamps[0]).getTime();
        const last = new Date(timestamps[timestamps.length - 1]).getTime();
        const duration = last - first;
        if (!Number.isNaN(duration)) {
          durations.push(duration);
        }
      }
    }

    if (durations.length === 0) return null;
    const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    return Number.isNaN(avg) ? null : avg;
  }

  /**
   * Find the timestamps of the first occurrence of each step type (in order)
   * within a session's events.
   */
  private findStepTimestamps(
    events: readonly SessionEvent[],
    stepTypes: readonly string[]
  ): string[] {
    const timestamps: string[] = [];
    let searchFrom = 0;

    for (const stepType of stepTypes) {
      let found = false;
      for (let i = searchFrom; i < events.length; i++) {
        if (events[i].eventType === stepType) {
          timestamps.push(events[i].timestamp);
          searchFrom = i + 1;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    return timestamps;
  }
}
