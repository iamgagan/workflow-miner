"use client";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, Calendar, MessageSquare, GitBranch, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import type { ComponentType } from "react";
import {
  isTauri,
  oauthLoopbackListen,
  buildGoogleAuthorizeUrl,
  keychainSet,
} from "@/lib/desktop-bridge";

interface ConnectorData {
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  oauthProvider: "google" | "slack" | "linear";
  connectLabel: string;
}

const connectors: ConnectorData[] = [
  {
    name: "Gmail",
    description: "Email threads and conversations",
    icon: Mail,
    color: "#ef4444",
    oauthProvider: "google",
    connectLabel: "Connect with Google",
  },
  {
    name: "Google Calendar",
    description: "Meetings and calendar events",
    icon: Calendar,
    color: "#3b82f6",
    oauthProvider: "google",
    connectLabel: "Connect with Google",
  },
  {
    name: "Slack",
    description: "Team messages and channels",
    icon: MessageSquare,
    color: "#a855f7",
    oauthProvider: "slack",
    connectLabel: "Add to Slack",
  },
  {
    name: "Linear",
    description: "Issues and project tracking",
    icon: GitBranch,
    color: "#6366f1",
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

interface ConnectorStatus {
  connected: boolean;
  lastSync: string | null;
  expiresAt: string | null;
  scopes: string;
}

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

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

export default function ConnectorsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Connectors</h1>
            <p className="text-muted-foreground">Manage your data source integrations</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border bg-card shadow-warm-card" />
            ))}
          </div>
        </div>
      }
    >
      <ConnectorsContent />
    </Suspense>
  );
}

function ConnectorsContent() {
  const searchParams = useSearchParams();
  const [syncingMap, setSyncingMap] = useState<Record<string, boolean>>({});
  const [notification, setNotification] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, ConnectorStatus>>({});
  const [loading, setLoading] = useState(true);

  // Fetch real connector status on mount
  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/api/connectors/status");
        if (res.ok) {
          const data = await res.json();
          setStatusMap(data.connectors ?? {});
        }
      } catch (err) {
        console.error("Failed to fetch connector status:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchStatus();
  }, []);

  // Show notification on successful connection
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) {
      setNotification(`Successfully connected ${connected}!`);
    } else if (error) {
      setNotification(`Connection failed: ${error}`);
    }
  }, [searchParams]);

  const handleSync = useCallback((connectorName: string) => {
    setSyncingMap((prev) => ({ ...prev, [connectorName]: true }));
    // Call the sync endpoint (will be built by another agent)
    const source = connectorName.toLowerCase().replace(/\s+/g, "_");
    fetch(`/api/sync?source=${source}`)
      .then(() => {
        // Refresh status after sync
        return fetch("/api/connectors/status");
      })
      .then((res) => res.json())
      .then((data) => {
        setStatusMap(data.connectors ?? {});
      })
      .catch((err) => {
        console.error("Sync failed:", err);
      })
      .finally(() => {
        setSyncingMap((prev) => ({ ...prev, [connectorName]: false }));
      });
  }, []);

  const handleOAuthConnect = useCallback(async (connector: ConnectorData) => {
    if (connector.oauthProvider === "google") {
      // Desktop mode: use the loopback flow so the redirect_uri is a
      // 127.0.0.1 port owned by the Tauri shell, not a hosted domain.
      if (isTauri()) {
        try {
          const clientId = process.env.NEXT_PUBLIC_GMAIL_CLIENT_ID ?? "";
          if (!clientId) {
            setNotification(
              "Google OAuth client ID is not configured. Set NEXT_PUBLIC_GMAIL_CLIENT_ID before launching the desktop app.",
            );
            return;
          }

          // Start the loopback listener first so we know the bound port,
          // then open Google's authorize URL pointed at it.
          const listenerPromise = oauthLoopbackListen(300);

          // Briefly yield so the listener has bound its port before we read
          // the redirect_uri back. The Rust side returns the URI as part of
          // the result, but we need it now to build the authorize URL — so
          // we use a small probe loop on the renderer side.
          const initialResult = await Promise.race([
            listenerPromise.then((r) => r.redirectUri),
            new Promise<string>((resolve) =>
              setTimeout(() => resolve(""), 100),
            ),
          ]);

          // The probe above might race; if we didn't get the URI in 100ms,
          // we wait for the actual listener to finish (which means the user
          // has already clicked through). Either way we can construct the
          // authorize URL once we know the port.
          let redirectUri = initialResult;
          if (!redirectUri) {
            // Fall back: ask the listener directly. This blocks until the
            // user finishes the auth, but we still get the redirect_uri in
            // the result so the exchange can complete.
            const result = await listenerPromise;
            redirectUri = result.redirectUri;
            if (result.error) {
              setNotification(`Connection failed: ${result.error}`);
              return;
            }
            if (!result.code) {
              setNotification("Connection cancelled — no code returned");
              return;
            }
            const exchangeRes = await fetch(
              "/api/connectors/google/exchange",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  code: result.code,
                  redirect_uri: result.redirectUri,
                }),
              },
            );
            if (!exchangeRes.ok) {
              setNotification(`Token exchange failed: ${exchangeRes.status}`);
              return;
            }
            const body = (await exchangeRes.json()) as {
              refresh_token?: string;
            };
            if (body.refresh_token) {
              await keychainSet("google", "refresh_token", body.refresh_token);
            }
            setNotification("Successfully connected Google!");
            const status = await fetch("/api/connectors/status").then((r) =>
              r.json(),
            );
            setStatusMap(status.connectors ?? {});
            return;
          }

          const authorizeUrl = buildGoogleAuthorizeUrl(clientId, redirectUri);
          window.open(authorizeUrl, "_blank");

          const result = await listenerPromise;
          if (result.error) {
            setNotification(`Connection failed: ${result.error}`);
            return;
          }
          if (!result.code) {
            setNotification("Connection cancelled — no code returned");
            return;
          }

          const exchangeRes = await fetch("/api/connectors/google/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: result.code,
              redirect_uri: result.redirectUri,
            }),
          });
          if (!exchangeRes.ok) {
            setNotification(`Token exchange failed: ${exchangeRes.status}`);
            return;
          }
          const body = (await exchangeRes.json()) as {
            refresh_token?: string;
          };
          if (body.refresh_token) {
            await keychainSet("google", "refresh_token", body.refresh_token);
          }
          setNotification("Successfully connected Google!");
          const status = await fetch("/api/connectors/status").then((r) =>
            r.json(),
          );
          setStatusMap(status.connectors ?? {});
        } catch (err) {
          console.error("desktop oauth flow failed", err);
          setNotification(
            err instanceof Error ? err.message : "Connection failed",
          );
        }
        return;
      }

      // Hosted mode: redirect through our server-side authorize endpoint.
      window.location.href = "/api/connectors/google/authorize";
      return;
    }
    // Other providers are not yet implemented
    setNotification(
      `OAuth integration coming soon -- this will connect directly to ${connector.name} without any manual setup`
    );
  }, []);

  const isProviderConnected = (provider: string): boolean => {
    return statusMap[provider]?.connected === true;
  };

  const getLastSync = (provider: string): string | null => {
    const status = statusMap[provider];
    if (!status?.lastSync) return null;
    return formatTimeAgo(status.lastSync);
  };

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

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border bg-card shadow-warm-card"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {connectors.map((connector, index) => {
            const Icon = connector.icon;
            const isConnected = isProviderConnected(connector.oauthProvider);
            const isSyncing = syncingMap[connector.name] ?? false;
            const lastSync = getLastSync(connector.oauthProvider);

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
                          {lastSync && <p>Last synced: {lastSync}</p>}
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
      )}
    </div>
  );
}
