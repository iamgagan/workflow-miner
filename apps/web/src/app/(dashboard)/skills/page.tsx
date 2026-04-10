"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SkillCard } from "@/components/skills/skill-card";
import { SkillDetail } from "@/components/skills/skill-detail";
import {
  MOCK_SKILLS,
  STATUS_COLORS,
  STATUS_LABELS,
  type SkillData,
  type SkillStatus,
} from "@/lib/mock-skills";

const FILTER_OPTIONS: readonly (SkillStatus | "all")[] = [
  "all",
  "draft",
  "pending_review",
  "approved",
  "exported",
] as const;

export default function SkillsPage() {
  const [selectedSkill, setSelectedSkill] = useState<SkillData | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const filteredSkills = statusFilter
    ? MOCK_SKILLS.filter((s) => s.status === statusFilter)
    : MOCK_SKILLS;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
      </div>

      <div className="flex flex-wrap gap-2">
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
            >
              <Badge
                variant="outline"
                className={`cursor-pointer text-xs transition-opacity ${
                  isActive
                    ? option === "all"
                      ? "border-primary text-primary"
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
    </div>
  );
}
