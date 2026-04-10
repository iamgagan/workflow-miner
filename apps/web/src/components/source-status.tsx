"use client";

import { motion } from "framer-motion";
import { Mail, MessageSquare, CheckCircle2, Calendar, Wifi, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type LucideIcon } from "lucide-react";

interface Source {
  name: string;
  icon: LucideIcon;
  connected: boolean;
  lastSync: string | null;
  eventCount: number;
}

const mockSources: Source[] = [
  { name: "Gmail", icon: Mail, connected: true, lastSync: "5 min ago", eventCount: 1247 },
  { name: "Slack", icon: MessageSquare, connected: true, lastSync: "2 min ago", eventCount: 3891 },
  { name: "Linear", icon: CheckCircle2, connected: false, lastSync: null, eventCount: 0 },
  { name: "Calendar", icon: Calendar, connected: true, lastSync: "10 min ago", eventCount: 562 },
];

export function SourceStatus() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
    >
      <Card>
        <CardContent className="p-6">
          <h3 className="mb-4 text-base font-semibold">Data Sources</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mockSources.map((source, i) => (
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
                          ? "border-emerald-500/20 bg-emerald-500/15 text-emerald-500"
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
                      ? `${source.eventCount.toLocaleString()} events \u00b7 Synced ${source.lastSync}`
                      : "Not configured"}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
