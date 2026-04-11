import { NextResponse } from "next/server";
import { listPatterns, getGBrainStats } from "@/lib/gbrain";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion } from "@/lib/openrouter";

interface ChatRequest {
  message: string;
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

    const llmResponse = await buildLLMResponse(message);
    const response = llmResponse ?? "I couldn't process your request right now. Please check that your OpenRouter API key is configured and try again.";

    return NextResponse.json({ response });
  } catch {
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}
