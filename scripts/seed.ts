import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

dotenv.config({ path: "apps/web/.env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function seed() {
  const organizationId = "org_test_" + randomUUID();

  console.log("Seeding organization:", organizationId);

  // We are not mocking embeddings since we didn't hook up OpenAI in this quick script,
  // but we can insert null or fake embeddings, or let pgvector handle it.
  
  const { error: pageError } = await supabase.from("brain_pages").insert([
    {
      organization_id: organizationId,
      slug: "doc-1",
      type: "concept",
      title: "Q3 Engineering Roadmap",
      compiled_truth: "The team agreed to migrate the database to Supabase and use pgvector for AI.",
    },
    {
      organization_id: organizationId,
      slug: "doc-2",
      type: "concept",
      title: "Employee Onboarding",
      compiled_truth: "All new engineers must complete the security training within their first week.",
    }
  ]);

  if (pageError) console.error("Page error:", pageError);

  const { error: timelineError } = await supabase.from("brain_timeline").insert([
    {
      organization_id: organizationId,
      date: new Date().toISOString(),
      source: "slack",
      summary: "Database Migration discussion",
      detail: "Garry said we should use Agentic RAG for the new Company Brain feature.",
    }
  ]);

  if (timelineError) console.error("Timeline error:", timelineError);

  console.log("Seeding complete.");
}

seed().catch(console.error);
