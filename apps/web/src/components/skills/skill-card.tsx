"use client";

import { motion } from "framer-motion";
import { ArrowRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SkillData } from "@/lib/skill-types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/skill-types";

interface SkillCardProps {
  readonly skill: SkillData;
  readonly index: number;
  readonly onClick: () => void;
}

export function SkillCard({ skill, index, onClick }: SkillCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
    >
      <button onClick={onClick} className="w-full text-left">
        <Card className="group cursor-pointer border-border/50 bg-card/80 shadow-warm-card backdrop-blur transition-colors hover:border-border hover:bg-card">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
                  {skill.name}
                </h3>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${STATUS_COLORS[skill.status]}`}
                >
                  {STATUS_LABELS[skill.status]}
                </Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                {skill.description}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="font-mono">v{skill.version}</span>
              <span>&middot;</span>
              <span>{skill.steps.length} steps</span>
              <span>&middot;</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(skill.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {skill.toolPermissions.slice(0, 4).map((perm) => (
                <Badge
                  key={perm}
                  variant="outline"
                  className="text-[10px] opacity-60"
                >
                  {perm}
                </Badge>
              ))}
              {skill.toolPermissions.length > 4 && (
                <Badge variant="outline" className="text-[10px] opacity-40">
                  +{skill.toolPermissions.length - 4}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              From pattern: {skill.patternSourceName}
            </p>
          </CardContent>
        </Card>
      </button>
    </motion.div>
  );
}
