import { DashboardShell } from "@/components/dashboard-shell";
import { BottomNav } from "@/components/bottom-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <DashboardShell email="user">
        {children}
      </DashboardShell>
      <BottomNav />
    </>
  );
}
