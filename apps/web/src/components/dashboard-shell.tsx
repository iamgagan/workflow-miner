"use client";

import { TopNav } from "@/components/top-nav";
import { WorkflowChat } from "@/components/workflow-chat";

interface DashboardShellProps {
  email: string;
  children: React.ReactNode;
}

export function DashboardShell({ email, children }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav email={email} />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">{children}</main>
        <WorkflowChat />
      </div>
    </div>
  );
}
