import { DashboardShell } from "@/components/dashboard-shell";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the current user via the env-gated supabase factory.
  // Hosted mode: real Supabase Auth user.
  // Desktop mode: the local user stub returned by the PGlite shim.
  let email = "user";
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data?.user?.email) email = data.user.email;
  } catch {
    // Fall through with the default placeholder.
  }

  return <DashboardShell email={email}>{children}</DashboardShell>;
}
