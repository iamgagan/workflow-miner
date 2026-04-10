import type { EventType } from "../normalize/schema.js";

/**
 * A single observed instance of a pattern — the sequence of event types
 * and whether the instance reached the final step.
 */
export interface PatternInstance {
  readonly eventTypes: readonly EventType[];
  readonly completed: boolean;
}

/**
 * A candidate pattern produced by the pattern miner, bundling the
 * canonical step sequence with every observed instance.
 */
export interface PatternCandidate {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly EventType[];
  readonly instances: readonly PatternInstance[];
}

/** Per-dimension breakdown returned alongside the composite score. */
export interface ScoreBreakdown {
  readonly frequency: number;
  readonly consistency: number;
  readonly completionRate: number;
  readonly automationPotential: number;
}

/** Final scored result for a single pattern. */
export interface ScoredPattern {
  readonly patternId: string;
  readonly name: string;
  readonly compositeScore: number;
  readonly breakdown: ScoreBreakdown;
}

/** Configurable weights for the composite score (must sum to 1). */
export interface ScoringWeights {
  readonly frequency: number;
  readonly consistency: number;
  readonly completionRate: number;
  readonly automationPotential: number;
}

/**
 * Event types considered "mechanical" (low decision-making) when
 * estimating automation potential.
 */
const MECHANICAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "message_sent",
  "message_received",
  "issue_created",
  "issue_updated",
  "followup_assigned",
  "artifact_shared",
]);

const DEFAULT_WEIGHTS: ScoringWeights = {
  frequency: 0.3,
  consistency: 0.3,
  completionRate: 0.2,
  automationPotential: 0.2,
};

export class PatternScorer {
  private readonly weights: ScoringWeights;

  constructor(weights: Partial<ScoringWeights> = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    const sum =
      this.weights.frequency +
      this.weights.consistency +
      this.weights.completionRate +
      this.weights.automationPotential;
    if (Math.abs(sum - 1) > 1e-6) {
      throw new Error(
        `Scoring weights must sum to 1, got ${sum}`
      );
    }
  }

  /**
   * Score a list of pattern candidates and return them ranked by
   * composite score (highest first).
   */
  scoreAll(candidates: readonly PatternCandidate[]): readonly ScoredPattern[] {
    const maxFrequency = Math.max(
      1,
      ...candidates.map((c) => c.instances.length),
    );

    const scored = candidates.map((c) => this.scoreOne(c, maxFrequency));

    return [...scored].sort((a, b) => b.compositeScore - a.compositeScore);
  }

  /**
   * Score a single pattern candidate.
   * `maxFrequency` is the highest instance count across all candidates,
   * used to normalise the frequency dimension to 0-100.
   */
  private scoreOne(candidate: PatternCandidate, maxFrequency: number): ScoredPattern {
    const breakdown: ScoreBreakdown = {
      frequency: this.computeFrequency(candidate, maxFrequency),
      consistency: this.computeConsistency(candidate),
      completionRate: this.computeCompletionRate(candidate),
      automationPotential: this.computeAutomationPotential(candidate),
    };

    const compositeScore = Math.round(
      breakdown.frequency * this.weights.frequency +
        breakdown.consistency * this.weights.consistency +
        breakdown.completionRate * this.weights.completionRate +
        breakdown.automationPotential * this.weights.automationPotential,
    );

    return {
      patternId: candidate.id,
      name: candidate.name,
      compositeScore,
      breakdown,
    };
  }

  // -- dimension helpers --------------------------------------------------

  /**
   * Frequency: normalised instance count relative to the most-frequent
   * candidate, scaled to 0-100.
   */
  private computeFrequency(
    candidate: PatternCandidate,
    maxFrequency: number,
  ): number {
    return Math.round((candidate.instances.length / maxFrequency) * 100);
  }

  /**
   * Consistency: average Jaccard similarity of each instance's event-type
   * set against the canonical step set.
   */
  private computeConsistency(candidate: PatternCandidate): number {
    if (candidate.instances.length === 0) return 0;

    const canonicalSet = new Set(candidate.steps);

    const similarities = candidate.instances.map((inst) => {
      const instSet = new Set(inst.eventTypes);
      return jaccard(canonicalSet, instSet);
    });

    return Math.round(
      (similarities.reduce((sum, s) => sum + s, 0) / similarities.length) *
        100,
    );
  }

  /**
   * Completion rate: percentage of instances that reached the final step.
   */
  private computeCompletionRate(candidate: PatternCandidate): number {
    if (candidate.instances.length === 0) return 0;

    const completed = candidate.instances.filter((i) => i.completed).length;
    return Math.round((completed / candidate.instances.length) * 100);
  }

  /**
   * Automation potential: ratio of mechanical steps to total steps in the
   * canonical sequence, scaled to 0-100.
   */
  private computeAutomationPotential(candidate: PatternCandidate): number {
    if (candidate.steps.length === 0) return 0;

    const mechanical = candidate.steps.filter((s) =>
      MECHANICAL_EVENT_TYPES.has(s),
    ).length;

    return Math.round((mechanical / candidate.steps.length) * 100);
  }
}

// -- utility --------------------------------------------------------------

/** Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 1 for two empty sets (vacuous equality). */
function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 1;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
