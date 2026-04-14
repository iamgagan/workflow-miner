"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <span className="text-2xl">!</span>
      </div>
      <h2 className="mt-4 text-xl font-semibold tracking-tight">
        Something went wrong
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        An unexpected error occurred. You can try reloading the page.
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
