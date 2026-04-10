import type { WeeklyDigestProps } from "./weekly-digest";

export const MOCK_DIGEST_DATA: WeeklyDigestProps = {
  weekStart: "Mar 31",
  weekEnd: "Apr 6",
  userName: "Sarah",
  dashboardUrl: "https://app.workflowminer.dev/dashboard",
  unsubscribeUrl: "https://app.workflowminer.dev/settings/notifications?unsubscribe=weekly",
  topPatterns: [
    {
      name: "Bug Triage \u2192 Fix \u2192 Review",
      occurrencesThisWeek: 4,
      occurrencesLastWeek: 3,
      totalHours: 2.3,
      sources: ["linear", "slack"],
      sparkline: [0, 1, 1, 0, 1, 0, 1],
    },
    {
      name: "Customer Escalation Pipeline",
      occurrencesThisWeek: 2,
      occurrencesLastWeek: 4,
      totalHours: 3.1,
      sources: ["gmail", "slack", "linear", "calendar"],
      sparkline: [1, 0, 0, 1, 0, 0, 0],
    },
    {
      name: "Standup \u2192 Plan \u2192 Execute",
      occurrencesThisWeek: 5,
      occurrencesLastWeek: 5,
      totalHours: 1.8,
      sources: ["calendar", "slack", "linear"],
      sparkline: [1, 1, 1, 0, 1, 1, 0],
    },
  ],
  newPatterns: [
    {
      name: "PR Review \u2192 Deploy \u2192 Monitor",
      detectedOn: "Apr 3",
      sources: ["github", "slack"],
    },
  ],
  exportReady: [
    {
      name: "Customer Escalation Pipeline",
      confidence: 91,
      exportUrl: "https://app.workflowminer.dev/patterns/p-003/export",
    },
    {
      name: "Bug Triage \u2192 Fix \u2192 Review",
      confidence: 87,
      exportUrl: "https://app.workflowminer.dev/patterns/p-001/export",
    },
  ],
};
