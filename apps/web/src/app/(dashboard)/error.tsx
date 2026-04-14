"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard-error]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">
        Something went wrong
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        There was a problem loading this page. Your data is safe.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}
