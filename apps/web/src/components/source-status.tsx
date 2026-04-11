"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mail, MessageSquare, CheckCircle2, Calendar, Wifi, WifiOff, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Source {
  name: string;
  key: string;
  icon: LucideIcon;
  connected: boolean;
  lastSync: string | null;
  eventCount: number;
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
    async function fetchStatus() {
      try {
        const supabase = createClient();

        // Check connector_tokens for connected sources
        const { data: tokens } = await supabase
          .from("connector_tokens")
          .select("provider, updated_at");

        const connectedProviders = new Map<string, string>();
        for (const t of tokens ?? []) {
          // Map 'google' provider to both gmail and calendar
          if (t.provider === "google") {
            connectedProviders.set("gmail", t.updated_at);
            connectedProviders.set("calendar", t.updated_at);
          } else {
            connectedProviders.set(t.provider, t.updated_at);
          }
        }

        // Count events per source from brain_timeline
        const { data: timeline } = await supabase
          .from("brain_timeline")
          .select("source")
          .limit(5000);

        const eventCounts = new Map<string, number>();
        for (const entry of timeline ?? []) {
          if (entry.source) {
            eventCounts.set(
              entry.source,
              (eventCounts.get(entry.source) ?? 0) + 1,
            );
          }
        }

        setSources(
          SOURCE_DEFS.map((def) => ({
            ...def,
            connected: connectedProviders.has(def.key) || eventCounts.has(def.key),
            lastSync: connectedProviders.get(def.key)
              ? relativeTime(connectedProviders.get(def.key)!)
              : null,
            eventCount: eventCounts.get(def.key) ?? 0,
          })),
        );
      } catch {
        // Keep defaults on error
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
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
