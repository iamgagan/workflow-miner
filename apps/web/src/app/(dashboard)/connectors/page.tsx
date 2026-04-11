"use client";

import { Mail, Calendar, MessageSquare, GitBranch, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import type { ComponentType } from "react";

interface ConnectorData {
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  status: "connected" | "not_configured";
  lastSync?: string;
  events?: number;
  setupHint?: string;
}

const connectors: ConnectorData[] = [
  {
    name: "Gmail",
    description: "Email threads and conversations",
    icon: Mail,
    color: "#ef4444",
    status: "connected",
    lastSync: "2 hours ago",
    events: 104,
  },
  {
    name: "Google Calendar",
    description: "Meetings and calendar events",
    icon: Calendar,
    color: "#3b82f6",
    status: "connected",
    lastSync: "2 hours ago",
    events: 24,
  },
  {
    name: "Slack",
    description: "Team messages and channels",
    icon: MessageSquare,
    color: "#a855f7",
    status: "not_configured",
    setupHint: "Add SLACK_BOT_TOKEN to your environment variables",
  },
  {
    name: "Linear",
    description: "Issues and project tracking",
    icon: GitBranch,
    color: "#6366f1",
    status: "not_configured",
    setupHint: "Add LINEAR_API_KEY to your environment variables",
  },
];

export default function ConnectorsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connectors</h1>
        <p className="text-muted-foreground">
          Manage your data source integrations
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {connectors.map((connector, index) => {
          const Icon = connector.icon;
          const isConnected = connector.status === "connected";

          return (
            <motion.div
              key={connector.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className="rounded-xl border bg-card p-6"
            >
              <div className="flex items-start gap-4">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: connector.color + "1a" }}
                >
                  <span style={{ color: connector.color }}>
                    <Icon className="h-6 w-6" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold">{connector.name}</h3>
                    {isConnected ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                        Not Configured
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connector.description}
                  </p>

                  {isConnected ? (
                    <div className="mt-4 flex items-center justify-between">
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p>Last synced: {connector.lastSync}</p>
                        <p>{connector.events} events</p>
                      </div>
                      <button className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
                        <RefreshCw className="h-3.5 w-3.5" />
                        Sync Now
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="text-xs text-muted-foreground">
                        {connector.setupHint}
                      </p>
                      <button className="mt-3 inline-flex items-center rounded-lg border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
                        Configure
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
