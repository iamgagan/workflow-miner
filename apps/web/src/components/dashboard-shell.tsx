"use client";

import { usePathname } from "next/navigation";
import { TopNav } from "@/components/top-nav";
import { WorkflowChat } from "@/components/workflow-chat";
import { FeedbackWidget } from "@/components/feedback-widget";

interface DashboardShellProps {
  email: string;
  children: React.ReactNode;
}

export function DashboardShell({ email, children }: DashboardShellProps) {
  const pathname = usePathname();
  // /brain is itself a full-page chat agent — showing the floating
  // WorkflowChat side panel on top of it gives users two competing
  // chats which is confusing. Hide it on /brain.
  const showSideChat = !pathname?.startsWith("/brain");

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav email={email} />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">{children}</main>
        {showSideChat && <WorkflowChat />}
      </div>
      <FeedbackWidget />
    </div>
  );
}
