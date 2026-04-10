import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface ActivityEvent {
  id: string;
  source: "gmail" | "slack" | "linear" | "calendar" | "system";
  description: string;
  timestamp: string;
  type: "ingest" | "pattern" | "skill" | "alert";
}

const MOCK_ACTIVITY: ActivityEvent[] = [
  {
    id: "1",
    source: "gmail",
    description: "Ingested 73 Gmail events",
    timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    type: "ingest",
  },
  {
    id: "2",
    source: "system",
    description: "New pattern detected: Bug Triage Loop",
    timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    type: "pattern",
  },
  {
    id: "3",
    source: "slack",
    description: "Ingested 41 Slack messages from #engineering",
    timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    type: "ingest",
  },
  {
    id: "4",
    source: "system",
    description: "Skill exported: Sprint Planning",
    timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    type: "skill",
  },
  {
    id: "5",
    source: "linear",
    description: "Synced 18 Linear issues from Project Alpha",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    type: "ingest",
  },
  {
    id: "6",
    source: "calendar",
    description: "Indexed 9 Calendar events for this week",
    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    type: "ingest",
  },
  {
    id: "7",
    source: "system",
    description: "Pattern confidence updated: PR Review Flow → 94%",
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    type: "pattern",
  },
  {
    id: "8",
    source: "gmail",
    description: "Ingested 28 Gmail events from newsletters",
    timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    type: "ingest",
  },
];

export async function GET() {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("activity_log")
      .select("id, source, description, created_at, type")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error || !data || data.length === 0) {
      return NextResponse.json(MOCK_ACTIVITY);
    }

    const events: ActivityEvent[] = data.map((row) => ({
      id: row.id,
      source: row.source,
      description: row.description,
      timestamp: row.created_at,
      type: row.type,
    }));

    return NextResponse.json(events);
  } catch {
    return NextResponse.json(MOCK_ACTIVITY);
  }
}
