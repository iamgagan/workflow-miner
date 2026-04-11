"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ReplayEvent {
  id: string;
  source: "gmail" | "slack" | "calendar" | "linear";
  title: string;
  summary: string;
  timestamp: string;
  detail: string;
}

const SOURCE_CONFIG: Record<
  ReplayEvent["source"],
  { color: string; bg: string; label: string }
> = {
  gmail: { color: "text-red-400", bg: "bg-red-500/10", label: "Gmail" },
  slack: { color: "text-purple-400", bg: "bg-purple-500/10", label: "Slack" },
  calendar: {
    color: "text-primary",
    bg: "bg-primary/10",
    label: "Calendar",
  },
  linear: { color: "text-indigo-400", bg: "bg-indigo-500/10", label: "Linear" },
};

interface EventCardProps {
  event: ReplayEvent;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
}

export function EventCard({
  event,
  isActive,
  isExpanded,
  onToggle,
  index,
}: EventCardProps) {
  const config = SOURCE_CONFIG[event.source];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        className={cn(
          "cursor-pointer shadow-warm-card transition-shadow",
          isActive && "ring-2 ring-accent",
        )}
        onClick={onToggle}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="secondary" className={cn(config.bg, config.color)}>
                {config.label}
              </Badge>
              <span className="truncate text-sm font-medium">
                {event.title}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {event.timestamp}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{event.summary}</p>
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                  {event.detail}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
