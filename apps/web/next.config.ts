import type { NextConfig } from "next";

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

export default nextConfig;
