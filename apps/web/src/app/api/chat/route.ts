import { NextResponse } from "next/server";
import { searchBrain, listPatterns, getGBrainStats } from "@/lib/gbrain";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/openrouter";

interface ChatRequest {
  message: string;
}

// ── Mock fallback responses ──────────────────────────────────────────────
const MOCK_RESPONSES: Record<string, string> = {
  "how do i handle bug reports?":
    "Based on your patterns, you handle bug reports in a 5-step workflow: **triage → assign → fix → review → close**. This pattern was detected 12 times last month with an average cycle time of 2.3 days.",
  "what's my most common workflow?":
    "Your most common workflow is **feature development**, detected 34 times in the last 30 days. It follows: **ticket created → branch opened → commits pushed → PR opened → review → merge → deploy**. Average duration: 4.1 days.",
  "show me patterns from last week":
    "Last week I detected **8 workflow patterns** across 142 events:\n\n1. **Feature dev** (×4) — avg 3.2 days\n2. **Bug fix** (×2) — avg 1.1 days\n3. **Code review** (×1) — avg 6 hours\n4. **Hotfix deploy** (×1) — avg 45 minutes\n\nYour team velocity increased 15% compared to the previous week.",
  "who reviews the most prs?":
    "Based on review patterns over the last 30 days:\n\n1. **@sarah** — 28 reviews (avg response: 2.4 hrs)\n2. **@alex** — 19 reviews (avg response: 4.1 hrs)\n3. **@jordan** — 14 reviews (avg response: 1.8 hrs)\n\nSarah is your most active reviewer, but Jordan has the fastest response time.",
  "what slows down my deployments?":
    "I found **3 bottlenecks** in your deployment workflow:\n\n1. **PR review wait time** — avg 6.2 hours (target: <2 hrs)\n2. **CI pipeline duration** — avg 18 minutes, but flaky tests cause 23% of runs to retry\n3. **Manual QA step** — adds 1-2 days when triggered\n\nRemoving the flaky tests could save ~4 hours per week.",
};

function findMockResponse(message: string): string {
  const lower = message.toLowerCase().trim();

  for (const [key, response] of Object.entries(MOCK_RESPONSES)) {
    if (lower.includes(key) || key.includes(lower)) {
      return response;
    }
  }

  if (lower.includes("bug") || lower.includes("issue")) {
    return MOCK_RESPONSES["how do i handle bug reports?"];
  }
  if (lower.includes("common") || lower.includes("frequent")) {
    return MOCK_RESPONSES["what's my most common workflow?"];
  }
  if (lower.includes("week") || lower.includes("recent") || lower.includes("last")) {
    return MOCK_RESPONSES["show me patterns from last week"];
  }
  if (lower.includes("review") || lower.includes("pr")) {
    return MOCK_RESPONSES["who reviews the most prs?"];
  }
  if (lower.includes("slow") || lower.includes("deploy") || lower.includes("bottleneck")) {
    return MOCK_RESPONSES["what slows down my deployments?"];
  }

  return "I found **23 active patterns** in your workflow data. Could you be more specific? Try asking about bug reports, deployments, code reviews, or your most common workflows.";
}

// ── Gather brain context for LLM ─────────────────────────────────────────

async function gatherBrainContext(): Promise<string> {
  const sections: string[] = [];

  try {
    const stats = await getGBrainStats();
    sections.push(
      `- Total events: ${stats.totalEvents}`,
      `- Active patterns: ${stats.activePatterns}`,
      `- Connected sources: ${stats.dataSources} of ${stats.totalSources}`,
    );
  } catch {
    // stats unavailable
  }

  try {
    const patterns = await listPatterns(10);
    if (patterns.length > 0) {
      const patternLines = patterns.slice(0, 5).map((p, i) => {
        const sources = p.sources.length > 0 ? p.sources.join(", ") : "multiple sources";
        return `  ${i + 1}. ${p.name} — score ${p.compositeScore}%, seen ${p.frequency} times (${sources})`;
      });
      sections.push(`\nTop patterns:\n${patternLines.join("\n")}`);
    }
  } catch {
    // patterns unavailable
  }

  try {
    const supabase = await createClient();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data: entries } = await supabase
      .from("brain_timeline")
      .select("source, summary, date")
      .gte("date", weekAgo.toISOString())
      .order("date", { ascending: false })
      .limit(10);

    if (entries && entries.length > 0) {
      const recentLines = entries.slice(0, 5).map((e) => `  - [${e.source}] ${e.summary}`);
      sections.push(`\nRecent activity:\n${recentLines.join("\n")}`);
    }
  } catch {
    // timeline unavailable
  }

  return sections.join("\n");
}

const SYSTEM_PROMPT_TEMPLATE = `You are the Workflow Miner AI assistant. You help users understand their workflow patterns detected from Gmail, Calendar, Slack, and Linear.

Here is the user's current data:
{context}

Answer concisely using markdown. Reference specific patterns and data when relevant. If the data above is sparse, still do your best to help the user based on what you know about workflow optimization.`;

async function buildLLMResponse(message: string): Promise<string | null> {
  try {
    const context = await gatherBrainContext();
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace("{context}", context || "No data available yet.");

    const reply = await chatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
    ]);

    return reply || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const { message } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    // Try LLM-powered response first, fall back to mock
    const llmResponse = await buildLLMResponse(message);
    const response = llmResponse ?? findMockResponse(message);

    return NextResponse.json({ response });
  } catch {
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}
