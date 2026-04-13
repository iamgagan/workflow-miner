"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "./score-badge";
import type { PatternData } from "@/lib/pattern-types";
import { SOURCE_COLORS, EVENT_TYPE_LABELS } from "@/lib/pattern-types";

interface PatternCardProps {
  pattern: PatternData;
}

export function PatternCard({ pattern }: PatternCardProps) {
  return (
    <motion.div layout animate={{ opacity: 1, scale: 1 }} initial={{ opacity: 0, scale: 0.95 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}>
      <Link href={`/patterns/${pattern.id}`}>
        <Card className="group cursor-pointer border-border/50 bg-card/80 shadow-warm-card backdrop-blur transition-colors hover:border-border hover:bg-card">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3">
            <ScoreBadge score={pattern.compositeScore} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
                {pattern.name}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {pattern.steps.length} steps &middot; seen {pattern.frequency}x
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-center gap-1 overflow-hidden">
              {pattern.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="inline-block max-w-[5rem] truncate rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {EVENT_TYPE_LABELS[step.eventType] ?? step.eventType}
                  </span>
                  {i < pattern.steps.length - 1 && (
                    <span className="text-[10px] text-muted-foreground/50">&rarr;</span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pattern.sources.map((src) => (
                <Badge
                  key={src}
                  variant="outline"
                  className={`text-[10px] capitalize ${SOURCE_COLORS[src] ?? ""}`}
                >
                  {src}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
