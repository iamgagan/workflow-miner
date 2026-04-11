import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/openrouter";

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

// ── Gather brain data for LLM coaching ──────────────────────────────────

interface BrainData {
  thisWeekCount: number;
  lastWeekCount: number;
  sources: string[];
  missingSources: string[];
  topWorkflow: string | null;
}

async function gatherCoachData(): Promise<BrainData | null> {
  try {
    const supabase = await createClient();
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const { data: thisWeek, error: twError } = await supabase
      .from("brain_timeline")
      .select("source, summary, date")
      .gte("date", weekAgo.toISOString())
      .order("date", { ascending: false });

    if (twError || !thisWeek || thisWeek.length === 0) return null;

    const { data: lastWeek } = await supabase
      .from("brain_timeline")
      .select("source, summary, date")
      .gte("date", twoWeeksAgo.toISOString())
      .lt("date", weekAgo.toISOString());

    const { data: workflows } = await supabase
      .from("brain_pages")
      .select("title, frontmatter, updated_at")
      .eq("type", "workflow")
      .order("updated_at", { ascending: false })
      .limit(5);

    const { data: allSources } = await supabase
      .from("brain_timeline")
      .select("source")
      .limit(1000);

    const connectedSources = [
      ...new Set((allSources ?? []).map((e) => e.source).filter(Boolean)),
    ];
    const allPossibleSources = ["gmail", "calendar", "slack", "linear"];
    const missing = allPossibleSources.filter(
      (s) => !connectedSources.includes(s),
    );

    const topWorkflow =
      workflows && workflows.length > 0 ? workflows[0].title : null;

    return {
      thisWeekCount: thisWeek.length,
      lastWeekCount: lastWeek?.length ?? 0,
      sources: connectedSources,
      missingSources: missing,
      topWorkflow,
    };
  } catch {
    return null;
  }
}

const COACH_SYSTEM_PROMPT = `You are a workflow coach. Analyze the user's work patterns and generate 2-4 actionable nudges.

Each nudge must be a JSON object with these exact fields:
- "type": one of "reminder", "suggestion", "warning", or "insight"
- "title": a short title (under 50 characters)
- "message": 1-2 sentence advice

Return ONLY a valid JSON array of nudges. Be specific and reference actual data. No additional text outside the JSON array.`;

function buildCoachUserPrompt(data: BrainData): string {
  return `User's data:
- This week: ${data.thisWeekCount} events
- Last week: ${data.lastWeekCount} events
- Connected sources: ${data.sources.join(", ") || "none"}
- Top workflow: ${data.topWorkflow ?? "none detected"}
- Missing sources: ${data.missingSources.join(", ") || "none"}`;
}

function parseNudgesFromLLM(raw: string): CoachNudge[] | null {
  try {
    // Extract JSON array from the response (handle markdown code blocks)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const validTypes = new Set(["reminder", "suggestion", "warning", "insight"]);
    const ts = new Date().toISOString();

    const nudges: CoachNudge[] = parsed
      .filter(
        (n: Record<string, unknown>) =>
          typeof n.type === "string" &&
          validTypes.has(n.type) &&
          typeof n.title === "string" &&
          typeof n.message === "string",
      )
      .map((n: Record<string, unknown>, i: number) => ({
        id: `llm-nudge-${i}`,
        type: n.type as CoachNudge["type"],
        title: String(n.title),
        message: String(n.message),
        timestamp: ts,
      }));

    return nudges.length > 0 ? nudges : null;
  } catch {
    return null;
  }
}

async function buildLLMNudges(): Promise<CoachNudge[] | null> {
  try {
    const data = await gatherCoachData();
    if (!data) return null;

    const userPrompt = buildCoachUserPrompt(data);

    const raw = await chatCompletion(
      [
        { role: "system", content: COACH_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.6 },
    );

    return parseNudgesFromLLM(raw);
  } catch {
    return null;
  }
}

export async function GET() {
  const llmNudges = await buildLLMNudges();
  return NextResponse.json(llmNudges ?? MOCK_NUDGES);
}
