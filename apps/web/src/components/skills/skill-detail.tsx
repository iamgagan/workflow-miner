"use client";

import { Copy, Download, ExternalLink, Shield, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SkillData } from "@/lib/mock-skills";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/mock-skills";

interface SkillDetailProps {
  readonly skill: SkillData | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function SkillDetail({ skill, open, onOpenChange }: SkillDetailProps) {
  if (!skill) return null;

  const handleCopyYaml = async () => {
    await navigator.clipboard.writeText(skill.yaml);
  };

  const handleDownload = () => {
    const blob = new Blob([skill.yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${skill.name.toLowerCase().replace(/\s+/g, "-")}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="space-y-1.5 p-6 pb-4">
          <div className="flex items-center gap-2">
            <DialogTitle>{skill.name}</DialogTitle>
            <Badge
              variant="outline"
              className={`text-[10px] ${STATUS_COLORS[skill.status]}`}
            >
              {STATUS_LABELS[skill.status]}
            </Badge>
          </div>
          <DialogDescription>{skill.description}</DialogDescription>
          <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground">
            <span className="font-mono">v{skill.version}</span>
            <span>&middot;</span>
            <span>Updated {new Date(skill.updatedAt).toLocaleDateString()}</span>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-5 px-6 pb-6">
            {/* Trigger Conditions */}
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Zap className="h-3.5 w-3.5" />
                Trigger Conditions
              </h4>
              <ul className="space-y-1.5">
                {skill.triggerConditions.map((condition) => (
                  <li
                    key={condition}
                    className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-foreground"
                  >
                    {condition}
                  </li>
                ))}
              </ul>
            </section>

            {/* Steps */}
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Steps
              </h4>
              <ol className="space-y-2">
                {skill.steps.map((step, i) => (
                  <li
                    key={step.description}
                    className="flex items-start gap-3 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground">{step.description}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {step.toolsUsed.map((tool) => (
                          <Badge
                            key={tool}
                            variant="outline"
                            className="text-[10px] capitalize"
                          >
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* Tool Permissions */}
            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Shield className="h-3.5 w-3.5" />
                Tool Permissions
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {skill.toolPermissions.map((perm) => (
                  <Badge
                    key={perm}
                    variant="outline"
                    className="text-[10px] font-mono"
                  >
                    {perm}
                  </Badge>
                ))}
              </div>
            </section>

            {/* Provenance */}
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Provenance
              </h4>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ExternalLink className="h-3 w-3" />
                Derived from pattern:{" "}
                <span className="font-medium text-foreground">
                  {skill.patternSourceName}
                </span>
              </p>
            </section>

            {/* YAML Preview */}
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                YAML Definition
              </h4>
              <pre className="overflow-x-auto rounded-lg border border-border/50 bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-300 dark:bg-zinc-900/50">
                <code>{skill.yaml}</code>
              </pre>
            </section>
          </div>
        </ScrollArea>

        {/* Footer Actions — Download and Copy are always available so users
            can grab the YAML for any pattern regardless of review status. */}
        <div className="flex items-center gap-2 border-t border-border/50 px-6 py-4">
          <Button size="sm" className="gap-1.5" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
            Download .yaml
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleCopyYaml}>
            <Copy className="h-3.5 w-3.5" />
            Copy YAML
          </Button>
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground">
            ID: {skill.id}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
