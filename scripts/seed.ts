import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: "apps/web/.env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function seed() {
  console.log("Seeding brain…");

  const { error: pageError } = await supabase.from("brain_pages").upsert(
    [
      {
        slug: "demo-roadmap",
        type: "concept",
        title: "Q3 Engineering Roadmap",
        compiled_truth: "The team agreed to migrate the database to Supabase and use pgvector for AI.",
      },
      {
        slug: "demo-onboarding",
        type: "concept",
        title: "Employee Onboarding",
        compiled_truth: "All new engineers must complete the security training within their first week.",
      },
    ],
    { onConflict: "slug" }
  );

  if (pageError) console.error("Page error:", pageError);

  const { error: timelineError } = await supabase.from("brain_timeline").insert([
    {
      date: new Date().toISOString(),
      source: "slack",
      summary: "Database Migration discussion",
      detail: "Garry said we should use Agentic RAG for the new Company Brain feature.",
    },
  ]);

  if (timelineError) console.error("Timeline error:", timelineError);

  console.log("Seeding complete.");
}

seed().catch(console.error);
