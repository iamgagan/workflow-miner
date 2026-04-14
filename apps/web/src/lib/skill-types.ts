export type SkillStatus = "draft" | "pending_review" | "approved" | "exported";

export interface SkillStep {
  readonly description: string;
  readonly toolsUsed: readonly string[];
}

export interface SkillData {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly status: SkillStatus;
  readonly patternSourceId: string;
  readonly patternSourceName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly triggerConditions: readonly string[];
  readonly steps: readonly SkillStep[];
  readonly toolPermissions: readonly string[];
  readonly yaml: string;
}

export const STATUS_COLORS: Record<SkillStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  pending_review: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  approved: "bg-primary/15 text-primary border-primary/30",
  exported: "bg-accent/15 text-accent border-accent/30",
};

export const STATUS_LABELS: Record<SkillStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  approved: "Approved",
  exported: "Exported",
};
