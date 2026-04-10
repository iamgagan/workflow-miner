"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Mail,
  MessageSquare,
  CheckCircle2,
  Calendar,
  Zap,
  Clock,
  Inbox,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActivityEvent } from "@/app/api/activity/route";

const SOURCE_CONFIG: Record<
  string,
  { icon: typeof Mail; color: string; dotColor: string }
> = {
  gmail: {
    icon: Mail,
    color: "text-red-500",
    dotColor: "bg-red-500",
  },
  slack: {
    icon: MessageSquare,
    color: "text-purple-500",
    dotColor: "bg-purple-500",
  },
  linear: {
    icon: CheckCircle2,
    color: "text-blue-500",
    dotColor: "bg-blue-500",
  },
  calendar: {
    icon: Calendar,
    color: "text-green-500",
    dotColor: "bg-green-500",
  },
  system: {
    icon: Zap,
    color: "text-amber-500",
    dotColor: "bg-amber-500",
  },
};

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4">
        <Inbox className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium text-muted-foreground">
        No activity yet
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Run your first ingest to get started
      </p>
    </div>
  );
}

export function ActivityTimeline() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity");
      if (res.ok) {
        const data: ActivityEvent[] = await res.json();
        setEvents(data);
      }
    } catch {
      // Keep existing events on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivity();
    const interval = setInterval(fetchActivity, 30_000);
    return () => clearInterval(interval);
  }, [fetchActivity]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Recent Activity
          </CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="relative">
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
              <div className="space-y-4">
                {events.map((event, i) => {
                  const config = SOURCE_CONFIG[event.source] ?? SOURCE_CONFIG.system;
                  const Icon = config.icon;

                  return (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.3,
                        delay: 0.7 + i * 0.06,
                      }}
                      className="relative flex items-start gap-3 pl-0"
                    >
                      <div
                        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background`}
                      >
                        <div
                          className={`absolute -left-[1px] -top-[1px] h-2 w-2 rounded-full ${config.dotColor}`}
                        />
                        <Icon className={`h-4 w-4 ${config.color}`} />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="text-sm leading-tight">
                          {event.description}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {relativeTime(event.timestamp)}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
