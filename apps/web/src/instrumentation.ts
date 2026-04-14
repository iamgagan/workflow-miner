// Next.js instrumentation hook. Loads the right Sentry config per runtime.
// Safe no-op if Sentry isn't configured (DSN missing).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Capture nested Node-runtime errors that Next doesn't automatically
// forward (e.g. from Server Components).
export { captureRequestError as onRequestError } from "@sentry/nextjs";
