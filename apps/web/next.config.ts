import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isDesktopBuild = process.env.WORKFLOW_MINER_BUILD_TARGET === "desktop";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The desktop shell bundles the production server via Tauri's resources.
  // Enabling standalone output emits a self-contained .next/standalone/
  // directory that the build script copies into apps/desktop/resources/next/.
  ...(isDesktopBuild ? { output: "standalone" } : {}),
  serverExternalPackages: [
    "@workflow-miner/engine",
    "googleapis",
    "better-sqlite3",
    "@electric-sql/pglite",
    "nodemailer",
  ],
};

// Only wrap with Sentry when a DSN is configured. Source map upload only
// runs when SENTRY_AUTH_TOKEN is also set (typically a Vercel secret).
const sentryEnabled = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Upload source maps only when auth token is present (otherwise skip
      // quietly — Sentry still receives events, just with minified stacks)
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
      },
    })
  : nextConfig;
