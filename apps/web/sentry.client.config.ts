// Browser-side Sentry init. Gated on NEXT_PUBLIC_SENTRY_DSN so the SDK
// is only activated when a DSN is configured — otherwise this is a no-op.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Keep the bundle + event volume small for alpha. No tracing,
    // no replay, no profiling — just errors.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
    // Don't spam Sentry during local dev unless explicitly enabled
    enabled: process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SENTRY_FORCE_ENABLE === "true",
  });
}
