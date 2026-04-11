"use client";

import { useState, useCallback } from "react";
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
  oauthProvider: "google" | "slack" | "linear";
  connectLabel: string;
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
    oauthProvider: "google",
    connectLabel: "Connect with Google",
  },
  {
    name: "Google Calendar",
    description: "Meetings and calendar events",
    icon: Calendar,
    color: "#3b82f6",
    status: "connected",
    lastSync: "2 hours ago",
    events: 24,
    oauthProvider: "google",
    connectLabel: "Connect with Google",
  },
  {
    name: "Slack",
    description: "Team messages and channels",
    icon: MessageSquare,
    color: "#a855f7",
    status: "not_configured",
    oauthProvider: "slack",
    connectLabel: "Add to Slack",
  },
  {
    name: "Linear",
    description: "Issues and project tracking",
    icon: GitBranch,
    color: "#6366f1",
    status: "not_configured",
    oauthProvider: "linear",
    connectLabel: "Connect Linear",
  },
];

const oauthButtonStyles: Record<string, string> = {
  google:
    "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-sm",
  slack:
    "bg-[#611f69] text-white hover:bg-[#4a154b]",
  linear:
    "bg-[#5e6ad2] text-white hover:bg-[#4e5bc2]",
};

function Notification({
  message,
  onDone,
}: {
  message: string;
  onDone: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      onAnimationComplete={() => {
        const timer = setTimeout(onDone, 3000);
        return () => clearTimeout(timer);
      }}
      className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-xl border bg-card px-5 py-3 text-sm shadow-warm-card"
    >
      {message}
    </motion.div>
  );
}

export default function ConnectorsPage() {
  const [syncingMap, setSyncingMap] = useState<Record<string, boolean>>({});
  const [lastSyncMap, setLastSyncMap] = useState<Record<string, string>>({});
  const [notification, setNotification] = useState<string | null>(null);

  const handleSync = useCallback((connectorName: string) => {
    setSyncingMap((prev) => ({ ...prev, [connectorName]: true }));
    setTimeout(() => {
      setSyncingMap((prev) => ({ ...prev, [connectorName]: false }));
      setLastSyncMap((prev) => ({ ...prev, [connectorName]: "Synced just now" }));
    }, 2000);
  }, []);

  const handleOAuthConnect = useCallback((connector: ConnectorData) => {
    setNotification(
      `OAuth integration coming soon \u2014 this will connect directly to ${connector.name} without any manual setup`
    );
  }, []);

  return (
    <div className="space-y-6">
      {notification && (
        <Notification
          message={notification}
          onDone={() => setNotification(null)}
        />
      )}

      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Connectors</h1>
        <p className="text-muted-foreground">
          Manage your data source integrations
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {connectors.map((connector, index) => {
          const Icon = connector.icon;
          const isConnected = connector.status === "connected";
          const isSyncing = syncingMap[connector.name] ?? false;
          const displayLastSync =
            lastSyncMap[connector.name] ?? connector.lastSync;

          return (
            <motion.div
              key={connector.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className="rounded-xl border bg-card p-6 shadow-warm-card"
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
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
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
                        <p>Last synced: {displayLastSync}</p>
                        <p>{connector.events} events</p>
                      </div>
                      <button
                        onClick={() => handleSync(connector.name)}
                        disabled={isSyncing}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`}
                        />
                        {isSyncing ? "Syncing..." : "Sync Now"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="text-xs text-muted-foreground">
                        Connect your {connector.name} account with one click
                      </p>
                      <button
                        onClick={() => handleOAuthConnect(connector)}
                        className={`mt-3 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${oauthButtonStyles[connector.oauthProvider]}`}
                      >
                        {connector.oauthProvider === "google" && (
                          <svg className="h-4 w-4" viewBox="0 0 24 24">
                            <path
                              fill="#4285F4"
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            />
                            <path
                              fill="#EA4335"
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                          </svg>
                        )}
                        {connector.connectLabel}
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
