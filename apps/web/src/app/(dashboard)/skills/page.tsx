"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SkillCard } from "@/components/skills/skill-card";
import { SkillDetail } from "@/components/skills/skill-detail";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  type SkillData,
  type SkillStatus,
} from "@/lib/skill-types";

const FILTER_OPTIONS: readonly (SkillStatus | "all")[] = [
  "all",
  "draft",
  "pending_review",
  "approved",
  "exported",
] as const;

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<SkillData | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills")
      .then((res) => res.json())
      .then((data: { skills: SkillData[] }) => {
        if (!cancelled) setSkills(data.skills ?? []);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSkills = statusFilter
    ? skills.filter((s) => s.status === statusFilter)
    : skills;

  const hasData = skills.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-accent" />
        <h1 className="font-display text-3xl font-bold tracking-tight">Skills</h1>
      </div>

      <div className={`flex flex-wrap gap-2 ${!hasData ? "opacity-40 pointer-events-none" : ""}`}>
        {FILTER_OPTIONS.map((option) => {
          const isActive =
            option === "all" ? statusFilter === null : statusFilter === option;
          const label =
            option === "all"
              ? "All"
              : STATUS_LABELS[option as SkillStatus];
          const colorClass =
            option === "all"
              ? ""
              : STATUS_COLORS[option as SkillStatus];

          return (
            <button
              key={option}
              onClick={() =>
                setStatusFilter(option === "all" ? null : option)
              }
              disabled={!hasData}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Badge
                variant="outline"
                className={`cursor-pointer text-xs transition-opacity ${
                  isActive
                    ? option === "all"
                      ? "border-accent text-accent"
                      : colorClass
                    : "opacity-50 hover:opacity-80"
                }`}
              >
                {label}
              </Badge>
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && !hasData && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Sparkles className="h-12 w-12 text-muted-foreground/30" />
          <h2 className="font-display text-xl font-semibold mt-4">No skills generated yet</h2>
          <p className="text-sm text-muted-foreground max-w-md mt-2">
            Skills are automatically created from your detected patterns. Mine
            patterns first, then come back here to download skill packs.
          </p>
          <Link
            href="/patterns"
            className="mt-4 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
          >
            View Patterns
          </Link>
        </div>
      )}

      {hasData && (
        <>
          <motion.div
            layout
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <AnimatePresence mode="popLayout">
              {filteredSkills.map((skill, index) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  index={index}
                  onClick={() => setSelectedSkill(skill)}
                />
              ))}
            </AnimatePresence>
          </motion.div>

          <SkillDetail
            skill={selectedSkill}
            open={selectedSkill !== null}
            onOpenChange={(open) => {
              if (!open) setSelectedSkill(null);
            }}
          />
        </>
      )}
    </div>
  );
}
