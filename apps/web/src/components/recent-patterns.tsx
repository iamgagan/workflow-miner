"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GitBranch, Mail, MessageSquare, Calendar, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const sourceIcons: Record<string, typeof Mail> = {
  gmail: Mail,
  slack: MessageSquare,
  linear: CheckCircle2,
  calendar: Calendar,
};

interface Pattern {
  name: string;
  confidence: number;
  sources: string[];
  lastSeen: string;
  frequency: string;
}

interface ApiPattern {
  id: string;
  name: string;
  compositeScore: number;
  sources: readonly string[];
  lastSeen: string;
  frequency: number;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}

function mapApiPattern(p: ApiPattern): Pattern {
  return {
    name: p.name,
    confidence: p.compositeScore / 100,
    sources: [...p.sources],
    lastSeen: formatRelativeTime(p.lastSeen),
    frequency: `${p.frequency}x / week`,
  };
}

function confidenceColor(confidence: number) {
  if (confidence >= 0.9) return "bg-primary/15 text-primary border-primary/20";
  if (confidence >= 0.8) return "bg-accent/15 text-accent border-accent/20";
  if (confidence >= 0.7) return "bg-amber-500/15 text-amber-500 border-amber-500/20";
  return "bg-muted text-muted-foreground";
}

export function RecentPatterns() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/patterns")
      .then((res) => res.json())
      .then((data: ApiPattern[]) => {
        setPatterns(data.map(mapApiPattern));
      })
      .catch(() => {
        setPatterns([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold">Recent Patterns</CardTitle>
          <GitBranch className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : patterns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No patterns detected yet
            </p>
          ) : (
            <div className="space-y-4">
              {patterns.map((pattern, i) => (
                <motion.div
                  key={pattern.name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.6 + i * 0.08 }}
                  className="flex items-start justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium">{pattern.name}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1">
                        {pattern.sources.map((source) => {
                          const Icon = sourceIcons[source] ?? GitBranch;
                          return (
                            <div
                              key={source}
                              className="flex h-5 w-5 items-center justify-center rounded-full border bg-background"
                            >
                              <Icon className="h-3 w-3 text-muted-foreground" />
                            </div>
                          );
                        })}
                      </div>
                      <span className="text-xs text-muted-foreground">{pattern.frequency}</span>
                      <span className="text-xs text-muted-foreground">&#183;</span>
                      <span className="text-xs text-muted-foreground">{pattern.lastSeen}</span>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={confidenceColor(pattern.confidence)}
                  >
                    {Math.round(pattern.confidence * 100)}%
                  </Badge>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
