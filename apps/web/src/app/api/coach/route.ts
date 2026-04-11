import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

async function buildBrainNudges(): Promise<CoachNudge[] | null> {
  try {
    const supabase = await createClient();
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    // Fetch this week's timeline
    const { data: thisWeek, error: twError } = await supabase
      .from("brain_timeline")
      .select("source, summary, date")
      .gte("date", weekAgo.toISOString())
      .order("date", { ascending: false });

    if (twError || !thisWeek || thisWeek.length === 0) return null;

    // Fetch last week's timeline for comparison
    const { data: lastWeek } = await supabase
      .from("brain_timeline")
      .select("source, summary, date")
      .gte("date", twoWeeksAgo.toISOString())
      .lt("date", weekAgo.toISOString());

    // Fetch workflow pages for pattern nudges
    const { data: workflows } = await supabase
      .from("brain_pages")
      .select("title, frontmatter, updated_at")
      .eq("type", "workflow")
      .order("updated_at", { ascending: false })
      .limit(5);

    // Fetch connected sources
    const { data: allSources } = await supabase
      .from("brain_timeline")
      .select("source")
      .limit(1000);

    const nudges: CoachNudge[] = [];
    const ts = now.toISOString();

    // ── Insight: Activity comparison ──────────────────────────────────
    const thisWeekCount = thisWeek.length;
    const lastWeekCount = lastWeek?.length ?? 0;

    if (lastWeekCount > 0) {
      const change = Math.round(
        ((thisWeekCount - lastWeekCount) / lastWeekCount) * 100,
      );
      if (change > 20) {
        nudges.push({
          id: "brain-activity-up",
          type: "insight",
          title: "Activity trending up",
          message: `You have **${thisWeekCount} events** this week — ${change}% more than last week. Great momentum!`,
          timestamp: ts,
        });
      } else if (change < -20) {
        nudges.push({
          id: "brain-activity-down",
          type: "insight",
          title: "Activity dip",
          message: `Only **${thisWeekCount} events** this week vs ${lastWeekCount} last week (${Math.abs(change)}% drop). Taking a lighter week?`,
          timestamp: ts,
        });
      }
    }

    // ── Suggestion: Unconnected sources ──────────────────────────────
    const connectedSources = new Set(
      (allSources ?? []).map((e) => e.source).filter(Boolean),
    );
    const allPossibleSources = ["gmail", "calendar", "slack", "linear"];
    const missing = allPossibleSources.filter((s) => !connectedSources.has(s));
    if (missing.length > 0 && missing.length < 4) {
      nudges.push({
        id: "brain-connect-more",
        type: "suggestion",
        title: "Connect more tools",
        message: `You're missing data from **${missing.join(", ")}**. Connecting them will improve pattern detection.`,
        timestamp: ts,
      });
    }

    // ── Insight: Top pattern ─────────────────────────────────────────
    if (workflows && workflows.length > 0) {
      const topWorkflow = workflows[0];
      const fm = (topWorkflow.frontmatter ?? {}) as Record<string, unknown>;
      const confidence = typeof fm.confidence === "number" ? fm.confidence : 0;
      if (confidence > 0.7) {
        nudges.push({
          id: "brain-top-pattern",
          type: "insight",
          title: "Strong pattern detected",
          message: `**${topWorkflow.title}** has ${Math.round(confidence * 100)}% confidence. This workflow is becoming a reliable team habit.`,
          timestamp: ts,
        });
      }
    }

    // ── Warning: Source going quiet ──────────────────────────────────
    const thisWeekSources = new Set(thisWeek.map((e) => e.source));
    const lastWeekSources = new Set((lastWeek ?? []).map((e) => e.source));
    for (const src of lastWeekSources) {
      if (!thisWeekSources.has(src)) {
        nudges.push({
          id: `brain-quiet-${src}`,
          type: "warning",
          title: `${src.charAt(0).toUpperCase() + src.slice(1)} went quiet`,
          message: `No events from **${src}** this week, but it was active last week. Check your connection.`,
          timestamp: ts,
        });
        break; // Only show one quiet-source warning
      }
    }

    // ── Reminder: High-potential workflow ─────────────────────────────
    if (workflows && workflows.length > 1) {
      for (const wf of workflows.slice(1)) {
        const fm = (wf.frontmatter ?? {}) as Record<string, unknown>;
        const breakdown = (fm.breakdown ?? {}) as Record<string, number>;
        if (breakdown.automationPotential > 0.7) {
          nudges.push({
            id: `brain-automate-${wf.title.slice(0, 20)}`,
            type: "suggestion",
            title: "Automation opportunity",
            message: `**${wf.title}** has ${Math.round(breakdown.automationPotential * 100)}% automation potential. Consider creating a skill from this pattern.`,
            timestamp: ts,
          });
          break;
        }
      }
    }

    return nudges.length > 0 ? nudges : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const brainNudges = await buildBrainNudges();
  return NextResponse.json(brainNudges ?? MOCK_NUDGES);
}
