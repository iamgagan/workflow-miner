export interface PatternStep {
  readonly eventType: string;
  readonly position: number;
  readonly sourceSystem: string;
}

export interface ScoreBreakdown {
  readonly frequency: number;
  readonly consistency: number;
  readonly completionRate: number;
  readonly automationPotential: number;
}

export interface EvidenceEvent {
  readonly id: string;
  readonly type: string;
  readonly source: string;
  readonly timestamp: string;
  readonly summary: string;
  readonly actor: string;
}

export interface PatternData {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly PatternStep[];
  readonly compositeScore: number;
  readonly breakdown: ScoreBreakdown;
  readonly frequency: number;
  readonly lastSeen: string;
  readonly sources: readonly string[];
  readonly evidence: readonly EvidenceEvent[];
}

export const MOCK_PATTERNS: readonly PatternData[] = [
  {
    id: "p-001",
    name: "Bug Triage \u2192 Fix \u2192 Review",
    steps: [
      { eventType: "issue_created", position: 0, sourceSystem: "linear" },
      { eventType: "message_sent", position: 1, sourceSystem: "slack" },
      { eventType: "issue_updated", position: 2, sourceSystem: "linear" },
      { eventType: "artifact_shared", position: 3, sourceSystem: "slack" },
      { eventType: "decision_made", position: 4, sourceSystem: "slack" },
    ],
    compositeScore: 87,
    breakdown: { frequency: 92, consistency: 85, completionRate: 80, automationPotential: 90 },
    frequency: 34,
    lastSeen: "2026-04-07T14:30:00Z",
    sources: ["linear", "slack"],
    evidence: [
      { id: "e-001", type: "issue_created", source: "linear", timestamp: "2026-04-07T09:15:00Z", summary: "LIN-482: Fix dashboard widget overflow on mobile viewports", actor: "Sarah Chen" },
      { id: "e-002", type: "message_sent", source: "slack", timestamp: "2026-04-07T09:18:00Z", summary: "#eng-bugs: \"Picking up LIN-482, looks like a flex-wrap issue\"", actor: "Sarah Chen" },
      { id: "e-003", type: "issue_updated", source: "linear", timestamp: "2026-04-07T11:42:00Z", summary: "LIN-482 moved to In Review \u2014 PR #1247 linked", actor: "Sarah Chen" },
      { id: "e-004", type: "artifact_shared", source: "slack", timestamp: "2026-04-07T11:45:00Z", summary: "#eng-bugs: shared PR #1247 for review", actor: "Sarah Chen" },
      { id: "e-005", type: "decision_made", source: "slack", timestamp: "2026-04-07T14:30:00Z", summary: "#eng-bugs: \"LGTM, merging\" \u2014 approved by @mike", actor: "Mike Torres" },
    ],
  },
  {
    id: "p-002",
    name: "Standup \u2192 Plan \u2192 Execute",
    steps: [
      { eventType: "meeting_held", position: 0, sourceSystem: "calendar" },
      { eventType: "message_sent", position: 1, sourceSystem: "slack" },
      { eventType: "issue_created", position: 2, sourceSystem: "linear" },
      { eventType: "followup_assigned", position: 3, sourceSystem: "linear" },
    ],
    compositeScore: 74,
    breakdown: { frequency: 80, consistency: 78, completionRate: 65, automationPotential: 70 },
    frequency: 28,
    lastSeen: "2026-04-08T10:00:00Z",
    sources: ["calendar", "slack", "linear"],
    evidence: [
      { id: "e-010", type: "meeting_held", source: "calendar", timestamp: "2026-04-08T09:00:00Z", summary: "Daily Standup \u2014 Engineering Team (15 min)", actor: "Team" },
      { id: "e-011", type: "message_sent", source: "slack", timestamp: "2026-04-08T09:20:00Z", summary: "#standup-notes: \"Priorities today: auth migration, perf audit\"", actor: "Alex Kim" },
      { id: "e-012", type: "issue_created", source: "linear", timestamp: "2026-04-08T09:35:00Z", summary: "LIN-501: Migrate OAuth2 token refresh to new provider", actor: "Alex Kim" },
      { id: "e-013", type: "followup_assigned", source: "linear", timestamp: "2026-04-08T09:40:00Z", summary: "LIN-501 assigned to @priya with due date Apr 10", actor: "Alex Kim" },
    ],
  },
  {
    id: "p-003",
    name: "Customer Escalation Pipeline",
    steps: [
      { eventType: "message_received", position: 0, sourceSystem: "gmail" },
      { eventType: "message_sent", position: 1, sourceSystem: "slack" },
      { eventType: "issue_created", position: 2, sourceSystem: "linear" },
      { eventType: "meeting_scheduled", position: 3, sourceSystem: "calendar" },
      { eventType: "message_sent", position: 4, sourceSystem: "gmail" },
      { eventType: "decision_made", position: 5, sourceSystem: "slack" },
    ],
    compositeScore: 91,
    breakdown: { frequency: 70, consistency: 95, completionRate: 98, automationPotential: 95 },
    frequency: 18,
    lastSeen: "2026-04-06T16:00:00Z",
    sources: ["gmail", "slack", "linear", "calendar"],
    evidence: [
      { id: "e-020", type: "message_received", source: "gmail", timestamp: "2026-04-06T08:12:00Z", summary: "From: support@acme.co \u2014 \"URGENT: API rate limits blocking production\"", actor: "Customer" },
      { id: "e-021", type: "message_sent", source: "slack", timestamp: "2026-04-06T08:20:00Z", summary: "#escalations: \"P0 from Acme \u2014 rate limit issue, need infra eyes\"", actor: "Dana Lee" },
      { id: "e-022", type: "issue_created", source: "linear", timestamp: "2026-04-06T08:25:00Z", summary: "LIN-498: Investigate rate limit headers returning 429 for Acme", actor: "Dana Lee" },
      { id: "e-023", type: "meeting_scheduled", source: "calendar", timestamp: "2026-04-06T08:30:00Z", summary: "Acme Escalation \u2014 War Room (30 min @ 9am)", actor: "Dana Lee" },
      { id: "e-024", type: "message_sent", source: "gmail", timestamp: "2026-04-06T14:00:00Z", summary: "To: support@acme.co \u2014 \"Fix deployed, rate limits restored\"", actor: "Dana Lee" },
      { id: "e-025", type: "decision_made", source: "slack", timestamp: "2026-04-06T16:00:00Z", summary: "#escalations: \"Acme confirmed fixed. Closing P0.\"", actor: "Dana Lee" },
    ],
  },
  {
    id: "p-004",
    name: "Feature Spec \u2192 Feedback Loop",
    steps: [
      { eventType: "artifact_shared", position: 0, sourceSystem: "slack" },
      { eventType: "message_sent", position: 1, sourceSystem: "slack" },
      { eventType: "meeting_scheduled", position: 2, sourceSystem: "calendar" },
      { eventType: "decision_made", position: 3, sourceSystem: "slack" },
      { eventType: "issue_created", position: 4, sourceSystem: "linear" },
    ],
    compositeScore: 68,
    breakdown: { frequency: 55, consistency: 72, completionRate: 70, automationPotential: 75 },
    frequency: 12,
    lastSeen: "2026-04-05T17:00:00Z",
    sources: ["slack", "calendar", "linear"],
    evidence: [
      { id: "e-030", type: "artifact_shared", source: "slack", timestamp: "2026-04-05T10:00:00Z", summary: "#product: shared \"Feature Spec: AI-powered search\" (Notion doc)", actor: "Jordan Wu" },
      { id: "e-031", type: "message_sent", source: "slack", timestamp: "2026-04-05T10:15:00Z", summary: "#product: \"Thoughts on the search ranking approach? Feels over-engineered\"", actor: "Priya Patel" },
      { id: "e-032", type: "meeting_scheduled", source: "calendar", timestamp: "2026-04-05T11:00:00Z", summary: "Search Feature Review \u2014 PM + Eng (45 min)", actor: "Jordan Wu" },
      { id: "e-033", type: "decision_made", source: "slack", timestamp: "2026-04-05T15:00:00Z", summary: "#product: \"Decision: ship MVP with BM25, defer ML ranking to v2\"", actor: "Jordan Wu" },
      { id: "e-034", type: "issue_created", source: "linear", timestamp: "2026-04-05T15:30:00Z", summary: "LIN-505: Implement BM25 search with keyword highlighting", actor: "Jordan Wu" },
    ],
  },
  {
    id: "p-005",
    name: "Weekly Metrics Review",
    steps: [
      { eventType: "meeting_held", position: 0, sourceSystem: "calendar" },
      { eventType: "artifact_shared", position: 1, sourceSystem: "slack" },
      { eventType: "message_sent", position: 2, sourceSystem: "slack" },
      { eventType: "followup_assigned", position: 3, sourceSystem: "linear" },
    ],
    compositeScore: 62,
    breakdown: { frequency: 90, consistency: 60, completionRate: 45, automationPotential: 50 },
    frequency: 42,
    lastSeen: "2026-04-07T11:00:00Z",
    sources: ["calendar", "slack", "linear"],
    evidence: [
      { id: "e-040", type: "meeting_held", source: "calendar", timestamp: "2026-04-07T10:00:00Z", summary: "Weekly Metrics Review \u2014 All Hands (30 min)", actor: "Team" },
      { id: "e-041", type: "artifact_shared", source: "slack", timestamp: "2026-04-07T10:35:00Z", summary: "#metrics: shared \"Week 14 Dashboard\" (Grafana snapshot)", actor: "Ops Bot" },
      { id: "e-042", type: "message_sent", source: "slack", timestamp: "2026-04-07T10:40:00Z", summary: "#metrics: \"P95 latency up 12% \u2014 need to investigate cache hit rate\"", actor: "Mike Torres" },
      { id: "e-043", type: "followup_assigned", source: "linear", timestamp: "2026-04-07T11:00:00Z", summary: "LIN-510: Investigate cache miss rate spike in week 14", actor: "Mike Torres" },
    ],
  },
  {
    id: "p-006",
    name: "Deploy \u2192 Monitor \u2192 Rollback",
    steps: [
      { eventType: "artifact_shared", position: 0, sourceSystem: "slack" },
      { eventType: "message_sent", position: 1, sourceSystem: "slack" },
      { eventType: "issue_updated", position: 2, sourceSystem: "linear" },
    ],
    compositeScore: 55,
    breakdown: { frequency: 45, consistency: 68, completionRate: 50, automationPotential: 55 },
    frequency: 8,
    lastSeen: "2026-04-04T20:00:00Z",
    sources: ["slack", "linear"],
    evidence: [
      { id: "e-050", type: "artifact_shared", source: "slack", timestamp: "2026-04-04T18:00:00Z", summary: "#deploys: Deploy v2.14.3 to production (Vercel)", actor: "CI Bot" },
      { id: "e-051", type: "message_sent", source: "slack", timestamp: "2026-04-04T18:15:00Z", summary: "#deploys: \"Error rate spiking post-deploy \u2014 investigating\"", actor: "Sarah Chen" },
      { id: "e-052", type: "issue_updated", source: "linear", timestamp: "2026-04-04T20:00:00Z", summary: "LIN-499 status \u2192 Done: rolled back v2.14.3, hotfix in v2.14.4", actor: "Sarah Chen" },
    ],
  },
];

export function getPatternById(id: string): PatternData | undefined {
  return MOCK_PATTERNS.find((p) => p.id === id);
}

export const SOURCE_COLORS: Record<string, string> = {
  slack: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  gmail: "bg-red-500/15 text-red-400 border-red-500/30",
  linear: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  calendar: "bg-primary/15 text-primary border-primary/30",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  message_sent: "Message Sent",
  message_received: "Message Received",
  decision_made: "Decision Made",
  issue_created: "Issue Created",
  issue_updated: "Issue Updated",
  meeting_scheduled: "Meeting Scheduled",
  meeting_held: "Meeting Held",
  meeting_cancelled: "Meeting Cancelled",
  followup_assigned: "Followup Assigned",
  artifact_shared: "Artifact Shared",
};
