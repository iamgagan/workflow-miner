import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET /api/health — used by Vercel monitoring + external uptime checks.
// Returns 200 if the app is up and Supabase is reachable; 503 otherwise.
//
// Public on purpose — health endpoints must work without auth so the load
// balancer / monitor can call them. Only returns boolean reachability,
// never row data.
export async function GET() {
  const checks: Record<string, "ok" | "down" | "skipped"> = {
    web: "ok",
    supabase: "skipped",
  };

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      // Cheapest possible reachability probe — count rows in brain_pages.
      // Works whether or not the table has data.
      const { error } = await admin
        .from("brain_pages")
        .select("id", { count: "exact", head: true });
      checks.supabase = error ? "down" : "ok";
    } catch {
      checks.supabase = "down";
    }
  }

  const ok = Object.values(checks).every((v) => v !== "down");
  return NextResponse.json(
    {
      ok,
      checks,
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
      now: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
