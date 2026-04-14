// Server-side Sentry init (Node runtime). Gated on SENTRY_DSN so it
// no-ops cleanly when not configured.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.SENTRY_ENV ?? process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
    enabled: process.env.NODE_ENV === "production" || process.env.SENTRY_FORCE_ENABLE === "true",
  });
}
