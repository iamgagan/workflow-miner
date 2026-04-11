import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@workflow-miner/engine", "googleapis", "better-sqlite3"],
};

export default nextConfig;
