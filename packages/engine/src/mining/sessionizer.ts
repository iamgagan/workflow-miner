import type { EventRow } from "../db/repositories/event-repository.js";
import type {
  SessionRepository,
  InsertSession,
} from "../db/repositories/session-repository.js";
import { randomUUID } from "node:crypto";

export interface SessionizerOptions {
  /** Maximum gap in minutes between events in the same session (default: 30) */
  readonly gapThresholdMinutes?: number;
}

export interface Session {
  readonly sessionId: string;
  readonly actorId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly eventIds: readonly string[];
  readonly sourceSystems: readonly string[];
  readonly metadata: {
    readonly dominantTopic: string | null;
    readonly conversationIds: readonly string[];
  };
}

/**
 * Groups normalized events into coherent work sessions using:
 * - Temporal proximity (configurable gap threshold)
 * - Shared participants (actor_id)
 * - Conversation threading (conversation_id)
 */
export class Sessionizer {
  private readonly gapThresholdMs: number;

  constructor(private readonly options: SessionizerOptions = {}) {
    const gapMinutes = options.gapThresholdMinutes ?? 30;
    this.gapThresholdMs = gapMinutes * 60 * 1000;
  }

  /**
   * Groups events into sessions. Events must be pre-sorted by timestamp.
   * Groups by actor_id, then merges sessions that share conversation threads.
   */
  groupEvents(events: readonly EventRow[]): readonly Session[] {
    if (events.length === 0) return [];

    // Group events by actor
    const eventsByActor = new Map<string, EventRow[]>();
    for (const event of events) {
      const existing = eventsByActor.get(event.actor_id);
      if (existing) {
        existing.push(event);
      } else {
        eventsByActor.set(event.actor_id, [event]);
      }
    }

    const allSessions: Session[] = [];

    for (const [actorId, actorEvents] of eventsByActor) {
      // Sort by timestamp within each actor group
      const sorted = [...actorEvents].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const sessions = this.buildActorSessions(actorId, sorted);
      allSessions.push(...sessions);
    }

    // Sort final sessions by start time
    return allSessions.sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }

  /**
   * Groups events and persists them to the session repository.
   */
  groupAndStore(
    events: readonly EventRow[],
    repo: SessionRepository
  ): readonly Session[] {
    const sessions = this.groupEvents(events);

    const inserts: InsertSession[] = sessions.map((s) => ({
      session_id: s.sessionId,
      actor_id: s.actorId,
      start_time: s.startTime,
      end_time: s.endTime,
      event_count: s.eventIds.length,
      source_systems: JSON.stringify(s.sourceSystems),
      metadata: JSON.stringify(s.metadata),
    }));

    try {
      repo.insertMany(inserts);
    } catch (error) {
      throw new Error(
        `Failed to persist ${inserts.length} sessions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return sessions;
  }

  private buildActorSessions(
    actorId: string,
    sortedEvents: readonly EventRow[]
  ): Session[] {
    // Phase 1: Split into temporal clusters
    const clusters = this.splitByTimeGap(sortedEvents);

    // Phase 2: Merge clusters that share conversation threads
    const merged = this.mergeByConversation(clusters);

    // Phase 3: Convert clusters to Session objects
    return merged.map((cluster) => this.clusterToSession(actorId, cluster));
  }

  private splitByTimeGap(
    events: readonly EventRow[]
  ): EventRow[][] {
    if (events.length === 0) return [];

    const clusters: EventRow[][] = [[events[0]]];

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      const gap =
        new Date(curr.timestamp).getTime() -
        new Date(prev.timestamp).getTime();

      if (gap > this.gapThresholdMs) {
        clusters.push([curr]);
      } else {
        clusters[clusters.length - 1].push(curr);
      }
    }

    return clusters;
  }

  private mergeByConversation(clusters: EventRow[][]): EventRow[][] {
    if (clusters.length <= 1) return clusters;

    // Build a map of conversation_id → cluster indices
    const convToClusterIdx = new Map<string, Set<number>>();
    for (let i = 0; i < clusters.length; i++) {
      for (const event of clusters[i]) {
        if (event.conversation_id) {
          const existing = convToClusterIdx.get(event.conversation_id);
          if (existing) {
            existing.add(i);
          } else {
            convToClusterIdx.set(event.conversation_id, new Set([i]));
          }
        }
      }
    }

    // Union-find with union-by-rank to merge clusters sharing conversations
    const parent = clusters.map((_, i) => i);
    const rank = new Array<number>(clusters.length).fill(0);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      if (rank[ra] < rank[rb]) {
        parent[ra] = rb;
      } else if (rank[ra] > rank[rb]) {
        parent[rb] = ra;
      } else {
        parent[rb] = ra;
        rank[ra]++;
      }
    };

    for (const indices of convToClusterIdx.values()) {
      const arr = [...indices];
      for (let i = 1; i < arr.length; i++) {
        union(arr[0], arr[i]);
      }
    }

    // Group clusters by their root
    const groups = new Map<number, EventRow[]>();
    for (let i = 0; i < clusters.length; i++) {
      const root = find(i);
      const existing = groups.get(root);
      if (existing) {
        existing.push(...clusters[i]);
      } else {
        groups.set(root, [...clusters[i]]);
      }
    }

    // Sort events within each merged group (non-mutating)
    return [...groups.values()].map((events) =>
      [...events].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    );
  }

  private clusterToSession(actorId: string, events: readonly EventRow[]): Session {
    const eventIds = events.map((e) => e.event_id);
    const sources = [...new Set(events.map((e) => e.source_system))];
    const conversationIds = [
      ...new Set(
        events
          .map((e) => e.conversation_id)
          .filter((id): id is string => id !== null)
      ),
    ];

    // Determine dominant topic from event types
    const typeCounts = new Map<string, number>();
    for (const event of events) {
      typeCounts.set(
        event.event_type,
        (typeCounts.get(event.event_type) ?? 0) + 1
      );
    }
    let dominantTopic: string | null = null;
    let maxCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantTopic = type;
      }
    }

    return {
      sessionId: randomUUID(),
      actorId,
      startTime: events[0].timestamp,
      endTime: events[events.length - 1].timestamp,
      eventIds,
      sourceSystems: sources,
      metadata: {
        dominantTopic,
        conversationIds,
      },
    };
  }
}
