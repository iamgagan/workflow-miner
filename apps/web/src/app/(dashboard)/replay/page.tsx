"use client";

import Link from "next/link";
import { Play, GitBranch, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ReplayPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Workflow Replay
        </h1>
        <p className="text-muted-foreground">
          Step through captured workflow sequences to see how work moves across
          tools.
        </p>
      </div>

      <Card className="shadow-warm-card">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Play className="h-8 w-8 text-primary" />
          </div>
          <h2 className="font-display text-xl font-semibold mt-6">
            Replay is coming soon
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mt-2">
            Visual workflow replay will let you step through detected patterns
            event by event, seeing how work flows across Gmail, Slack, Linear,
            and Calendar.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/patterns"
              className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              <GitBranch className="h-4 w-4" />
              View Patterns
            </Link>
            <Link
              href="/connectors"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Connect Tools
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
