"use client";

import { motion } from "framer-motion";
import type { ReplayEvent } from "./event-card";

const SOURCE_COLORS: Record<ReplayEvent["source"], string> = {
  gmail: "#ef4444",
  slack: "#a855f7",
  calendar: "#22c55e",
  linear: "#3b82f6",
};

interface WorkflowPlayerProps {
  events: ReplayEvent[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

export function WorkflowPlayer({
  events,
  currentStep,
  onStepClick,
}: WorkflowPlayerProps) {
  const nodeRadius = 18;
  const nodeSpacing = 100;
  const paddingX = 40;
  const svgHeight = 80;
  const svgWidth = paddingX * 2 + (events.length - 1) * nodeSpacing;
  const cy = svgHeight / 2;

  return (
    <div className="w-full overflow-x-auto rounded-lg border bg-card p-4">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="min-w-full"
      >
        {/* Connector lines */}
        {events.map((_, i) => {
          if (i === 0) return null;
          const x1 = paddingX + (i - 1) * nodeSpacing;
          const x2 = paddingX + i * nodeSpacing;
          const reached = i <= currentStep;
          return (
            <motion.line
              key={`line-${i}`}
              x1={x1}
              y1={cy}
              x2={x2}
              y2={cy}
              stroke={reached ? "hsl(var(--primary))" : "hsl(var(--border))"}
              strokeWidth={2}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
            />
          );
        })}

        {/* Nodes */}
        {events.map((event, i) => {
          const cx = paddingX + i * nodeSpacing;
          const color = SOURCE_COLORS[event.source];
          const reached = i <= currentStep;
          const active = i === currentStep;

          return (
            <g
              key={event.id}
              className="cursor-pointer"
              onClick={() => onStepClick(i)}
            >
              {/* Pulse ring for active node */}
              {active && (
                <motion.circle
                  cx={cx}
                  cy={cy}
                  r={nodeRadius + 6}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  initial={{ opacity: 0, r: nodeRadius }}
                  animate={{
                    opacity: [0.6, 0],
                    r: [nodeRadius, nodeRadius + 12],
                  }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              )}

              {/* Node circle */}
              <motion.circle
                cx={cx}
                cy={cy}
                r={nodeRadius}
                fill={reached ? color : "transparent"}
                stroke={color}
                strokeWidth={2}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 20,
                  delay: i * 0.08,
                }}
              />

              {/* Step number */}
              <text
                x={cx}
                y={cy + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                className="select-none text-xs font-semibold"
                fill={reached ? "white" : color}
              >
                {i + 1}
              </text>

              {/* Source label */}
              <text
                x={cx}
                y={cy + nodeRadius + 14}
                textAnchor="middle"
                className="select-none text-[10px]"
                fill="hsl(var(--muted-foreground))"
              >
                {event.source}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
