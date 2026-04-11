"use client";

import Link from "next/link";
import { Play } from "lucide-react";

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

      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Play className="h-12 w-12 text-muted-foreground/30" />
        <h2 className="font-display text-xl font-semibold mt-4">No workflows to replay</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-2">
          Once you have connected tools and patterns are detected, you can replay workflow sequences here
        </p>
        <Link
          href="/connectors"
          className="mt-4 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
        >
          Connect Tools
        </Link>
      </div>
    </div>
  );
}
