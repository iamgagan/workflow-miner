"use client";

import { motion } from "framer-motion";
import { GitBranch, Mail, MessageSquare, Calendar, CheckCircle2 } from "lucide-react";
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

const mockPatterns: Pattern[] = [
  {
    name: "Bug Triage → Assign → Fix → Review",
    confidence: 0.94,
    sources: ["linear", "slack", "gmail"],
    lastSeen: "2 hours ago",
    frequency: "12x / week",
  },
  {
    name: "Standup → Update Linear → Post Summary",
    confidence: 0.87,
    sources: ["calendar", "linear", "slack"],
    lastSeen: "5 hours ago",
    frequency: "5x / week",
  },
  {
    name: "PR Review → Comment → Approve → Merge",
    confidence: 0.82,
    sources: ["slack", "gmail"],
    lastSeen: "1 day ago",
    frequency: "8x / week",
  },
  {
    name: "Email Thread → Calendar Invite → Meeting Notes",
    confidence: 0.76,
    sources: ["gmail", "calendar", "slack"],
    lastSeen: "1 day ago",
    frequency: "3x / week",
  },
  {
    name: "Incident Alert → Triage → Resolution → Postmortem",
    confidence: 0.71,
    sources: ["slack", "linear"],
    lastSeen: "3 days ago",
    frequency: "2x / week",
  },
];

function confidenceColor(confidence: number) {
  if (confidence >= 0.9) return "bg-primary/15 text-primary border-primary/20";
  if (confidence >= 0.8) return "bg-accent/15 text-accent border-accent/20";
  if (confidence >= 0.7) return "bg-amber-500/15 text-amber-500 border-amber-500/20";
  return "bg-muted text-muted-foreground";
}

export function RecentPatterns() {
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
          <div className="space-y-4">
            {mockPatterns.map((pattern, i) => (
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
        </CardContent>
      </Card>
    </motion.div>
  );
}
