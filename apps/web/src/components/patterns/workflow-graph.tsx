"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Mail,
  CheckCircle2,
  AlertCircle,
  Calendar,
  FileText,
  Users,
  ArrowRightLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PatternStep } from "@/lib/mock-patterns";
import { EVENT_TYPE_LABELS, SOURCE_COLORS } from "@/lib/mock-patterns";

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

const SOURCE_NODE_COLORS: Record<string, string> = {
  slack: "border-purple-500 bg-purple-500/10",
  gmail: "border-red-500 bg-red-500/10",
  linear: "border-blue-500 bg-blue-500/10",
  calendar: "border-green-500 bg-green-500/10",
};

interface WorkflowGraphProps {
  steps: readonly PatternStep[];
}

export function WorkflowGraph({ steps }: WorkflowGraphProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <WorkflowGraphSkeleton count={steps.length} />;

  const nodeWidth = 140;
  const nodeHeight = 64;
  const gapX = 80;
  const padX = 24;
  const padY = 40;
  const totalWidth = steps.length * nodeWidth + (steps.length - 1) * gapX + padX * 2;
  const totalHeight = nodeHeight + padY * 2;

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border/50 bg-muted/20 p-4">
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width={totalWidth}
        height={totalHeight}
        className="mx-auto block"
      >
        {/* edges */}
        {steps.slice(0, -1).map((_, i) => {
          const x1 = padX + i * (nodeWidth + gapX) + nodeWidth;
          const x2 = padX + (i + 1) * (nodeWidth + gapX);
          const y = padY + nodeHeight / 2;
          return (
            <g key={`edge-${i}`}>
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke="currentColor"
                className="text-border"
                strokeWidth={2}
              />
              <motion.circle
                r={4}
                fill="currentColor"
                className="text-primary"
                initial={{ cx: x1, cy: y }}
                animate={{ cx: [x1, x2], cy: y }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.3,
                  ease: "easeInOut",
                }}
              />
              {/* arrow head */}
              <polygon
                points={`${x2 - 6},${y - 5} ${x2},${y} ${x2 - 6},${y + 5}`}
                fill="currentColor"
                className="text-border"
              />
            </g>
          );
        })}

        {/* nodes */}
        {steps.map((step, i) => {
          const x = padX + i * (nodeWidth + gapX);
          const y = padY;
          const Icon = EVENT_ICONS[step.eventType] ?? FileText;
          const sourceColor = SOURCE_NODE_COLORS[step.sourceSystem] ?? "border-border bg-muted/40";

          return (
            <motion.g
              key={i}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <foreignObject x={x} y={y} width={nodeWidth} height={nodeHeight}>
                <div
                  className={cn(
                    "flex h-full flex-col items-center justify-center rounded-lg border-2 px-2",
                    sourceColor,
                  )}
                >
                  <Icon className="mb-1 h-4 w-4 text-foreground/70" />
                  <span className="text-center text-[10px] font-medium leading-tight text-foreground/90">
                    {EVENT_TYPE_LABELS[step.eventType] ?? step.eventType}
                  </span>
                  <span className="mt-0.5 text-[9px] capitalize text-muted-foreground">
                    {step.sourceSystem}
                  </span>
                </div>
              </foreignObject>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}

function WorkflowGraphSkeleton({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-4 overflow-x-auto rounded-lg border border-border/50 bg-muted/20 p-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-16 w-[140px] animate-pulse rounded-lg bg-muted/40" />
          {i < count - 1 && <div className="h-0.5 w-12 animate-pulse bg-muted/40" />}
        </div>
      ))}
    </div>
  );
}
