import { NextResponse } from "next/server";
import { searchBrain, listPatterns, getGBrainStats } from "@/lib/gbrain";
import { createClient } from "@/lib/supabase/server";

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

// ── Brain-powered response builder ───────────────────────────────────────

async function buildBrainResponse(message: string): Promise<string | null> {
  try {
    const lower = message.toLowerCase();

    // Stats / overview queries
    if (lower.includes("overview") || lower.includes("stats") || lower.includes("summary") || lower.includes("how many")) {
      const stats = await getGBrainStats();
      if (stats.totalEvents === 0) return null;

      return [
        `Here's your workflow overview:\n`,
        `• **${stats.totalEvents} events** captured across **${stats.dataSources}** data sources`,
        `• **${stats.activePatterns} active patterns** detected`,
        stats.dataSources < stats.totalSources
          ? `\nYou have ${stats.totalSources - stats.dataSources} unconnected sources — connecting them will improve pattern detection.`
          : "",
      ].filter(Boolean).join("\n");
    }

    // Pattern queries
    if (lower.includes("pattern") || lower.includes("workflow") || lower.includes("common") || lower.includes("frequent")) {
      const patterns = await listPatterns(10);
      if (patterns.length === 0) return null;

      const lines = patterns.slice(0, 5).map((p, i) => {
        const sources = p.sources.length > 0 ? p.sources.join(", ") : "multiple sources";
        return `${i + 1}. **${p.name}** — score ${p.compositeScore}%, seen ${p.frequency} times (${sources})`;
      });

      return [
        `I found **${patterns.length} workflow patterns**:\n`,
        ...lines,
        patterns.length > 5 ? `\n...and ${patterns.length - 5} more. Ask about a specific pattern for details.` : "",
      ].filter(Boolean).join("\n");
    }

    // Recent activity queries
    if (lower.includes("recent") || lower.includes("week") || lower.includes("last") || lower.includes("today")) {
      const supabase = await createClient();
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const { data: entries, error } = await supabase
        .from("brain_timeline")
        .select("source, summary, date")
        .gte("date", weekAgo.toISOString())
        .order("date", { ascending: false })
        .limit(20);

      if (error || !entries || entries.length === 0) return null;

      // Group by source
      const bySource = new Map<string, number>();
      for (const e of entries) {
        bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
      }

      const sourceLines = [...bySource.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([source, count]) => `• **${source}** — ${count} events`);

      const recentSummaries = entries.slice(0, 5).map((e) => `• ${e.summary}`);

      return [
        `In the past week, **${entries.length} events** were captured:\n`,
        ...sourceLines,
        `\n**Latest activity:**`,
        ...recentSummaries,
      ].join("\n");
    }

    // People queries
    if (lower.includes("who") || lower.includes("person") || lower.includes("people") || lower.includes("team")) {
      const people = await searchBrain("people/");
      if (people.length === 0) return null;

      const personPages = people.filter((p) => p.type === "person" || p.slug.startsWith("people/"));
      if (personPages.length === 0) return null;

      const lines = personPages.map((p) => `• **${p.title}**`);
      return [
        `I found **${personPages.length} people** in your workflow data:\n`,
        ...lines,
        `\nThey appear across your connected tools — ask about a specific person for their activity.`,
      ].join("\n");
    }

    // Tool / source queries
    if (lower.includes("tool") || lower.includes("source") || lower.includes("connector") || lower.includes("connected")) {
      const tools = await searchBrain("tools/");
      if (tools.length === 0) return null;

      const toolPages = tools.filter((p) => p.type === "tool" || p.slug.startsWith("tools/"));
      if (toolPages.length === 0) return null;

      const lines = toolPages.map((p) => `• **${p.title}**`);
      return [
        `You have **${toolPages.length} connected tools**:\n`,
        ...lines,
      ].join("\n");
    }

    // Generic search — try to find matching pages
    const results = await searchBrain(message, 5);
    if (results.length > 0) {
      const lines = results.map((p) => {
        const snippet = p.compiled_truth
          ? p.compiled_truth.slice(0, 120) + (p.compiled_truth.length > 120 ? "..." : "")
          : `Type: ${p.type}`;
        return `• **${p.title}** — ${snippet}`;
      });

      return [
        `I found **${results.length} results** matching your query:\n`,
        ...lines,
      ].join("\n");
    }

    return null;
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

    // Try brain-powered response first, fall back to mock
    const brainResponse = await buildBrainResponse(message);
    const response = brainResponse ?? findMockResponse(message);

    return NextResponse.json({ response });
  } catch {
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}
