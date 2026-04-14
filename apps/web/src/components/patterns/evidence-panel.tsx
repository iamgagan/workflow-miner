"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, MessageSquare, Mail, CheckCircle2, AlertCircle, Calendar, FileText, Users, ArrowRightLeft, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EvidenceEvent } from "@/lib/pattern-types";
import { SOURCE_COLORS } from "@/lib/pattern-types";

const EVENT_ICONS: Record<string, LucideIcon> = {
  message_sent: MessageSquare,
  message_received: Mail,
  decision_made: CheckCircle2,
  issue_created: AlertCircle,
  issue_updated: ArrowRightLeft,
  meeting_scheduled: Calendar,
  meeting_held: Users,
  meeting_cancelled: Calendar,
  followup_assigned: FileText,
  artifact_shared: FileText,
};

interface EvidencePanelProps {
  events: readonly EvidenceEvent[];
}

export function EvidencePanel({ events }: EvidencePanelProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-border/50 bg-card/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 p-4 text-left text-sm font-semibold text-foreground hover:bg-muted/30 transition-colors rounded-lg"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Evidence Events ({events.length})
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 px-4 pb-4">
              {events.map((event, i) => {
                const Icon = EVENT_ICONS[event.type] ?? FileText;
                return (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/30 transition-colors"
                  >
                    <div className="relative mt-0.5">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {i < events.length - 1 && (
                        <div className="absolute left-1/2 top-full h-4 w-px -translate-x-1/2 bg-border/50" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground/90 leading-snug">{event.summary}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="outline" className={cn("text-[10px] capitalize", SOURCE_COLORS[event.source])}>
                          {event.source}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{event.actor}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(event.timestamp).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
