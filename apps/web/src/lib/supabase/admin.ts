import { createClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase client configured with the service_role key,
 * bypassing Row Level Security. Useful for background jobs and cron.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

