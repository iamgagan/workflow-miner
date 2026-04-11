"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { ActivityEvent } from "@/app/api/activity/route";

interface ChartDataPoint {
  date: string;
  events: number;
  patterns: number;
}

function bucketByDay(events: ActivityEvent[]): ChartDataPoint[] {
  const buckets = new Map<string, { events: number; patterns: number }>();

  for (const event of events) {
    const d = new Date(event.timestamp);
    const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const existing = buckets.get(key) ?? { events: 0, patterns: 0 };
    existing.events += 1;
    if (event.type === "pattern") {
      existing.patterns += 1;
    }
    buckets.set(key, existing);
  }

  return Array.from(buckets.entries()).map(([date, counts]) => ({
    date,
    events: counts.events,
    patterns: counts.patterns,
  }));
}

export function ActivityChart() {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasRealData, setHasRealData] = useState(false);

  useEffect(() => {
    fetch("/api/activity")
      .then((res) => res.json())
      .then((events: ActivityEvent[]) => {
        if (events.length > 0) {
          const bucketed = bucketByDay(events);
          setData(bucketed);
          setHasRealData(true);
        }
      })
      .catch(() => {
        // fail silently
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
    >
      <Card className="shadow-warm-card">
        <CardHeader>
          <CardTitle className="font-display text-base font-semibold">Events Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !hasRealData ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Connect sources to see activity
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eventGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="patternGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="events"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#eventGradient)"
                    name="Events"
                  />
                  <Area
                    type="monotone"
                    dataKey="patterns"
                    stroke="hsl(var(--accent))"
                    strokeWidth={2}
                    fill="url(#patternGradient)"
                    name="Patterns"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
