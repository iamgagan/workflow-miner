"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Clock, Hash, Layers, Loader2, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreBadge } from "@/components/patterns/score-badge";
import { WorkflowGraph } from "@/components/patterns/workflow-graph";
import { ScoreRadar } from "@/components/patterns/score-radar";
import { EvidencePanel } from "@/components/patterns/evidence-panel";

const SOURCE_COLORS: Record<string, string> = {
  slack: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  gmail: "bg-red-500/10 text-red-600 border-red-500/20",
  linear: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  calendar: "bg-green-500/10 text-green-600 border-green-500/20",
};

interface PatternDetail {
  id: string;
  name: string;
  steps: Array<{ eventType: string; position: number; sourceSystem: string }>;
  compositeScore: number;
  breakdown: {
    frequency: number;
    consistency: number;
    completionRate: number;
    automationPotential: number;
  };
  frequency: number;
  lastSeen: string;
  sources: string[];
  evidence: Array<Record<string, unknown>>;
}

export default function PatternDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const routeParams = useParams();
  const id = routeParams.id as string;
  const [pattern, setPattern] = useState<PatternDetail | null>(null);
  const [evidence, setEvidence] = useState<Array<{ id: string; type: string; source: string; timestamp: string; summary: string; actor: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/patterns/${id}`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/patterns/${id}/evidence`).then((r) =>
        r.ok ? r.json() : [],
      ),
    ])
      .then(([patternData, evidenceData]) => {
        if (!patternData || patternData.error) {
          setNotFound(true);
        } else {
          setPattern(patternData);
          setEvidence(Array.isArray(evidenceData) ? evidenceData : []);
        }
      })
      .catch(() => {
        setNotFound(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !pattern) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Layers className="h-12 w-12 text-muted-foreground/30" />
        <h2 className="mt-4 font-display text-xl font-semibold">Pattern not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This pattern may have been removed or hasn&apos;t been detected yet.
        </p>
        <Link href="/patterns" className="mt-4">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Patterns
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/patterns">
          <Button variant="ghost" size="icon" className="mt-1 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <ScoreBadge score={pattern.compositeScore} size="lg" />
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                {pattern.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {pattern.sources.map((src) => (
                  <Badge
                    key={src}
                    variant="outline"
                    className={`text-xs capitalize ${SOURCE_COLORS[src] ?? ""}`}
                  >
                    {src}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <motion.div
        className="grid gap-4 sm:grid-cols-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center gap-3 p-4">
            <Layers className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{pattern.steps.length}</p>
              <p className="text-xs text-muted-foreground">Steps</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center gap-3 p-4">
            <Hash className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{pattern.frequency}</p>
              <p className="text-xs text-muted-foreground">Occurrences</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {new Date(pattern.lastSeen).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
              <p className="text-xs text-muted-foreground">Last Seen</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Workflow graph */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-base">Workflow Graph</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkflowGraph steps={pattern.steps} />
          </CardContent>
        </Card>
      </motion.div>

      {/* Score radar + Evidence side by side on lg */}
      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="border-border/50 bg-card/50">
            <CardHeader>
              <CardTitle className="text-base">Score Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreRadar breakdown={pattern.breakdown} />
              <div className="mt-4 grid grid-cols-2 gap-2">
                {Object.entries(pattern.breakdown).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                    <span className="text-xs capitalize text-muted-foreground">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <EvidencePanel events={evidence} />
        </motion.div>
      </div>
    </div>
  );
}
