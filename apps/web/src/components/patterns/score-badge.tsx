"use client";

import { cn } from "@/lib/utils";

function scoreColor(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/40";
  if (score >= 60) return "bg-amber-500/15 text-amber-400 border-amber-500/40";
  return "bg-red-500/15 text-red-400 border-red-500/40";
}

export function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border font-bold tabular-nums",
        scoreColor(score),
        sizeClasses[size],
      )}
    >
      {score}
    </div>
  );
}
