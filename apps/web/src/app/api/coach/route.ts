import { NextResponse } from "next/server";

export interface CoachNudge {
  id: string;
  type: "reminder" | "suggestion" | "warning" | "insight";
  title: string;
  message: string;
  timestamp: string;
}

const MOCK_NUDGES: CoachNudge[] = [
  {
    id: "1",
    type: "reminder",
    title: "Changelog step missed",
    message:
      "You started release prep — last 3 times you forgot the changelog step.",
    timestamp: new Date().toISOString(),
  },
  {
    id: "2",
    type: "suggestion",
    title: "Pattern detected",
    message:
      "You usually run integration tests after merging to main. Want to add that to your workflow?",
    timestamp: new Date().toISOString(),
  },
  {
    id: "3",
    type: "warning",
    title: "Skipped code review",
    message:
      "Your last 2 PRs were merged without a review. Consider requesting one.",
    timestamp: new Date().toISOString(),
  },
  {
    id: "4",
    type: "insight",
    title: "Deploy frequency up",
    message:
      "You deployed 40% more this week vs last week. Nice momentum!",
    timestamp: new Date().toISOString(),
  },
];

export async function GET() {
  return NextResponse.json(MOCK_NUDGES);
}
