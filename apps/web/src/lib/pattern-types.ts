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

export const SOURCE_COLORS: Record<string, string> = {
  slack: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  gmail: "bg-red-500/15 text-red-400 border-red-500/30",
  linear: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  calendar: "bg-primary/15 text-primary border-primary/30",
  github: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  notion: "bg-gray-800/15 text-gray-300 border-gray-800/30",
  jira: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  outlook: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  message_sent: "Message Sent",
  message_received: "Message Received",
  decision_made: "Decision Made",
  issue_created: "Issue Created",
  issue_updated: "Issue Updated",
  issue_closed: "Issue Closed",
  meeting_scheduled: "Meeting Scheduled",
  meeting_held: "Meeting Held",
  meeting_cancelled: "Meeting Cancelled",
  followup_assigned: "Followup Assigned",
  artifact_shared: "Artifact Shared",
  pr_opened: "PR Opened",
  pr_merged: "PR Merged",
  review_submitted: "Review Submitted",
  commit_pushed: "Commit Pushed",
  comment_added: "Comment Added",
  doc_created: "Doc Created",
  doc_updated: "Doc Updated",
};
