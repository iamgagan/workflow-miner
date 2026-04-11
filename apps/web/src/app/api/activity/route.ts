import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface ActivityEvent {
  id: string;
  source: "gmail" | "slack" | "linear" | "calendar" | "system";
  description: string;
  timestamp: string;
  type: "ingest" | "pattern" | "skill" | "alert";
}


export async function GET() {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("activity_log")
      .select("id, source, description, created_at, type")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error || !data || data.length === 0) {
      return NextResponse.json([]);
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
    return NextResponse.json([]);
  }
}
