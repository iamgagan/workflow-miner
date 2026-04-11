"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mail, MessageSquare, CheckCircle2, Calendar, Wifi, WifiOff, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type LucideIcon } from "lucide-react";

interface Source {
  name: string;
  key: string;
  icon: LucideIcon;
  connected: boolean;
  lastSync: string | null;
  eventCount: number;
}

interface SourcesApiResponse {
  sources: Array<{
    key: string;
    connected: boolean;
    lastSync: string | null;
    eventCount: number;
  }>;
}

const SOURCE_DEFS: Array<{ name: string; key: string; icon: LucideIcon }> = [
  { name: "Gmail", key: "gmail", icon: Mail },
  { name: "Slack", key: "slack", icon: MessageSquare },
  { name: "Linear", key: "linear", icon: CheckCircle2 },
  { name: "Calendar", key: "calendar", icon: Calendar },
];

function relativeTime(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

export function SourceStatus() {
  const [sources, setSources] = useState<Source[]>(
    SOURCE_DEFS.map((d) => ({
      ...d,
      connected: false,
      lastSync: null,
      eventCount: 0,
    })),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/sources");
        if (!res.ok) return;
        const data = (await res.json()) as SourcesApiResponse;
        if (cancelled) return;

        const lookup = new Map<string, SourcesApiResponse["sources"][number]>();
        for (const s of data.sources) {
          lookup.set(s.key, s);
        }

        setSources(
          SOURCE_DEFS.map((def) => {
            const status = lookup.get(def.key);
            return {
              ...def,
              connected: status?.connected ?? false,
              lastSync: status?.lastSync ? relativeTime(status.lastSync) : null,
              eventCount: status?.eventCount ?? 0,
            };
          }),
        );
      } catch {
        // Keep defaults on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
    >
      <Card className="shadow-warm-card">
        <CardContent className="p-6">
          <h3 className="mb-4 text-base font-semibold">Data Sources</h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {sources.map((source, i) => (
                <motion.div
                  key={source.name}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.7 + i * 0.08 }}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className={`rounded-lg p-2 ${source.connected ? "bg-primary/10" : "bg-muted"}`}>
                    <source.icon className={`h-4 w-4 ${source.connected ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{source.name}</span>
                      <Badge
                        variant="outline"
                        className={
                          source.connected
                            ? "border-primary/20 bg-primary/15 text-primary"
                            : "border-muted bg-muted text-muted-foreground"
                        }
                      >
                        {source.connected ? (
                          <><Wifi className="mr-1 h-3 w-3" /> Connected</>
                        ) : (
                          <><WifiOff className="mr-1 h-3 w-3" /> Disconnected</>
                        )}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {source.connected
                        ? `${source.eventCount.toLocaleString()} events${source.lastSync ? ` · Synced ${source.lastSync}` : ""}`
                        : "Not configured"}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
