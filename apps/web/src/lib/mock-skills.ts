export type SkillStatus = "draft" | "pending_review" | "approved" | "exported";

export interface SkillStep {
  readonly description: string;
  readonly toolsUsed: readonly string[];
}

export interface SkillData {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly status: SkillStatus;
  readonly patternSourceId: string;
  readonly patternSourceName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly triggerConditions: readonly string[];
  readonly steps: readonly SkillStep[];
  readonly toolPermissions: readonly string[];
  readonly yaml: string;
}

export const MOCK_SKILLS: readonly SkillData[] = [
  {
    id: "sk-001",
    name: "Bug Triage Automation",
    description: "Automatically triages incoming bugs by assigning severity, routing to the right team, and posting a summary to Slack.",
    version: "1.2.0",
    status: "exported",
    patternSourceId: "p-001",
    patternSourceName: "Bug Triage \u2192 Fix \u2192 Review",
    createdAt: "2026-03-15T10:00:00Z",
    updatedAt: "2026-04-01T14:30:00Z",
    triggerConditions: [
      "New issue created in Linear with label 'bug'",
      "Slack message in #eng-bugs mentioning 'P0' or 'P1'",
    ],
    steps: [
      { description: "Parse issue details and extract severity indicators", toolsUsed: ["linear", "nlp"] },
      { description: "Assign severity label (P0-P3) based on keywords and reporter", toolsUsed: ["linear"] },
      { description: "Route to on-call engineer via Slack mention", toolsUsed: ["slack"] },
      { description: "Post triage summary to #eng-bugs", toolsUsed: ["slack"] },
    ],
    toolPermissions: ["linear:read", "linear:write", "slack:post", "slack:read"],
    yaml: `name: bug-triage-automation
version: 1.2.0
description: Automatically triages incoming bugs
triggers:
  - event: issue_created
    source: linear
    filter:
      labels: [bug]
  - event: message_sent
    source: slack
    filter:
      channel: eng-bugs
      contains: ["P0", "P1"]
steps:
  - action: parse_issue
    tools: [linear, nlp]
    output: severity
  - action: assign_label
    tools: [linear]
    input: severity
  - action: route_to_oncall
    tools: [slack]
  - action: post_summary
    tools: [slack]
    template: triage-summary
permissions:
  - linear:read
  - linear:write
  - slack:post
  - slack:read`,
  },
  {
    id: "sk-002",
    name: "Escalation Response",
    description: "Detects customer escalations and orchestrates a war room: creates a Linear issue, schedules an emergency meeting, and tracks resolution.",
    version: "2.0.1",
    status: "approved",
    patternSourceId: "p-003",
    patternSourceName: "Customer Escalation Pipeline",
    createdAt: "2026-03-20T09:00:00Z",
    updatedAt: "2026-04-06T16:00:00Z",
    triggerConditions: [
      "Email received with subject containing 'URGENT' or 'escalation'",
      "Slack message in #escalations tagged @here or @channel",
    ],
    steps: [
      { description: "Classify escalation severity from email content", toolsUsed: ["gmail", "nlp"] },
      { description: "Create Linear issue with P0 label and escalation template", toolsUsed: ["linear"] },
      { description: "Post to #escalations with issue link", toolsUsed: ["slack"] },
      { description: "Schedule war room meeting with relevant stakeholders", toolsUsed: ["calendar"] },
      { description: "Send acknowledgment to customer", toolsUsed: ["gmail"] },
    ],
    toolPermissions: ["gmail:read", "gmail:send", "linear:write", "slack:post", "calendar:create"],
    yaml: `name: escalation-response
version: 2.0.1
description: Detects and responds to customer escalations
triggers:
  - event: message_received
    source: gmail
    filter:
      subject_contains: [URGENT, escalation]
  - event: message_sent
    source: slack
    filter:
      channel: escalations
      mentions: ["@here", "@channel"]
steps:
  - action: classify_severity
    tools: [gmail, nlp]
    output: severity_level
  - action: create_issue
    tools: [linear]
    template: escalation-p0
  - action: notify_team
    tools: [slack]
    channel: escalations
  - action: schedule_warroom
    tools: [calendar]
    duration: 30m
  - action: acknowledge_customer
    tools: [gmail]
    template: escalation-ack
permissions:
  - gmail:read
  - gmail:send
  - linear:write
  - slack:post
  - calendar:create`,
  },
  {
    id: "sk-003",
    name: "Standup Digest",
    description: "After daily standup, generates a digest of discussed topics, creates follow-up tasks in Linear, and posts a summary to Slack.",
    version: "1.0.0",
    status: "pending_review",
    patternSourceId: "p-002",
    patternSourceName: "Standup \u2192 Plan \u2192 Execute",
    createdAt: "2026-04-05T11:00:00Z",
    updatedAt: "2026-04-08T10:00:00Z",
    triggerConditions: [
      "Calendar event 'Daily Standup' ends",
      "Slack message in #standup-notes within 30 min of meeting end",
    ],
    steps: [
      { description: "Extract action items from standup notes", toolsUsed: ["slack", "nlp"] },
      { description: "Create Linear issues for new action items", toolsUsed: ["linear"] },
      { description: "Assign issues to mentioned team members", toolsUsed: ["linear"] },
      { description: "Post digest summary to #standup-notes", toolsUsed: ["slack"] },
    ],
    toolPermissions: ["slack:read", "linear:write", "calendar:read"],
    yaml: `name: standup-digest
version: 1.0.0
description: Generates standup digest and creates follow-ups
triggers:
  - event: meeting_ended
    source: calendar
    filter:
      title_contains: ["Daily Standup"]
  - event: message_sent
    source: slack
    filter:
      channel: standup-notes
      within: 30m
steps:
  - action: extract_action_items
    tools: [slack, nlp]
    output: action_items
  - action: create_issues
    tools: [linear]
    input: action_items
  - action: assign_owners
    tools: [linear]
  - action: post_digest
    tools: [slack]
    channel: standup-notes
permissions:
  - slack:read
  - linear:write
  - calendar:read`,
  },
  {
    id: "sk-004",
    name: "Feature Spec Reviewer",
    description: "When a feature spec is shared, collects team feedback, schedules a review meeting, and tracks the decision outcome.",
    version: "0.1.0",
    status: "draft",
    patternSourceId: "p-004",
    patternSourceName: "Feature Spec \u2192 Feedback Loop",
    createdAt: "2026-04-07T15:00:00Z",
    updatedAt: "2026-04-07T15:00:00Z",
    triggerConditions: [
      "Notion or Google Doc shared in #product channel",
    ],
    steps: [
      { description: "Detect shared spec document and extract key sections", toolsUsed: ["slack", "nlp"] },
      { description: "Prompt team members for async feedback with deadline", toolsUsed: ["slack"] },
      { description: "Schedule review meeting after feedback window closes", toolsUsed: ["calendar"] },
    ],
    toolPermissions: ["slack:read", "slack:post", "calendar:create"],
    yaml: `name: feature-spec-reviewer
version: 0.1.0
description: Collects feedback on shared feature specs
triggers:
  - event: artifact_shared
    source: slack
    filter:
      channel: product
      file_type: [notion, gdoc]
steps:
  - action: extract_spec
    tools: [slack, nlp]
    output: spec_sections
  - action: request_feedback
    tools: [slack]
    deadline: 48h
  - action: schedule_review
    tools: [calendar]
    after: feedback_deadline
permissions:
  - slack:read
  - slack:post
  - calendar:create`,
  },
  {
    id: "sk-005",
    name: "Metrics Alert Handler",
    description: "Monitors weekly metrics reviews and auto-creates investigation tasks when key metrics exceed thresholds.",
    version: "1.1.0",
    status: "pending_review",
    patternSourceId: "p-005",
    patternSourceName: "Weekly Metrics Review",
    createdAt: "2026-04-02T08:00:00Z",
    updatedAt: "2026-04-07T11:00:00Z",
    triggerConditions: [
      "Grafana alert fires with severity 'warning' or 'critical'",
      "Slack message in #metrics mentioning 'spike' or 'regression'",
    ],
    steps: [
      { description: "Parse alert details and identify affected metric", toolsUsed: ["slack", "grafana"] },
      { description: "Create investigation issue in Linear", toolsUsed: ["linear"] },
      { description: "Assign to relevant team member based on metric domain", toolsUsed: ["linear"] },
      { description: "Post alert summary with context to #metrics", toolsUsed: ["slack"] },
    ],
    toolPermissions: ["slack:read", "slack:post", "linear:write", "grafana:read"],
    yaml: `name: metrics-alert-handler
version: 1.1.0
description: Creates investigation tasks from metric alerts
triggers:
  - event: alert_fired
    source: grafana
    filter:
      severity: [warning, critical]
  - event: message_sent
    source: slack
    filter:
      channel: metrics
      contains: [spike, regression]
steps:
  - action: parse_alert
    tools: [slack, grafana]
    output: metric_details
  - action: create_investigation
    tools: [linear]
    template: metric-investigation
  - action: assign_owner
    tools: [linear]
    routing: metric_domain
  - action: post_summary
    tools: [slack]
    channel: metrics
permissions:
  - slack:read
  - slack:post
  - linear:write
  - grafana:read`,
  },
  {
    id: "sk-006",
    name: "Deploy Safety Net",
    description: "Monitors deployments, watches for error rate spikes, and triggers automatic rollback with team notification.",
    version: "1.0.0",
    status: "exported",
    patternSourceId: "p-006",
    patternSourceName: "Deploy \u2192 Monitor \u2192 Rollback",
    createdAt: "2026-03-28T16:00:00Z",
    updatedAt: "2026-04-04T20:00:00Z",
    triggerConditions: [
      "Deploy event detected in #deploys channel",
      "Error rate exceeds 5% threshold within 15 minutes post-deploy",
    ],
    steps: [
      { description: "Monitor error rate and latency for 15 min post-deploy", toolsUsed: ["grafana", "slack"] },
      { description: "If threshold exceeded, trigger automatic rollback", toolsUsed: ["vercel", "slack"] },
      { description: "Notify team and create post-mortem issue", toolsUsed: ["slack", "linear"] },
    ],
    toolPermissions: ["slack:read", "slack:post", "grafana:read", "vercel:deploy", "linear:write"],
    yaml: `name: deploy-safety-net
version: 1.0.0
description: Monitors deploys and triggers rollback on error spikes
triggers:
  - event: artifact_shared
    source: slack
    filter:
      channel: deploys
      contains: [deploy, deployed]
steps:
  - action: monitor_metrics
    tools: [grafana, slack]
    duration: 15m
    thresholds:
      error_rate: 5%
      p95_latency: 2000ms
  - action: auto_rollback
    tools: [vercel, slack]
    condition: threshold_exceeded
  - action: notify_and_track
    tools: [slack, linear]
    template: deploy-rollback
permissions:
  - slack:read
  - slack:post
  - grafana:read
  - vercel:deploy
  - linear:write`,
  },
];

export function getSkillById(id: string): SkillData | undefined {
  return MOCK_SKILLS.find((s) => s.id === id);
}

export const STATUS_COLORS: Record<SkillStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  pending_review: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  approved: "bg-primary/15 text-primary border-primary/30",
  exported: "bg-accent/15 text-accent border-accent/30",
};

export const STATUS_LABELS: Record<SkillStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  approved: "Approved",
  exported: "Exported",
};
