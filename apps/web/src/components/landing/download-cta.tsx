"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Apple, Monitor, Terminal } from "lucide-react";

type Platform = "macos" | "windows" | "linux" | "unknown";

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function DownloadCTA() {
  const [platform, setPlatform] = useState<Platform>("unknown");

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  return (
    <section className="border-t border-border/50 py-20">
      <motion.div
        className="mx-auto max-w-2xl px-4 text-center"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <h2 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
          Get Workflow Miner
        </h2>
        <p className="mt-4 text-muted-foreground">
          Download the desktop app or jump straight into the web experience.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4">
          {/* macOS button */}
          {(platform === "macos" || platform === "unknown") && (
            <motion.a
              href="#download-mac"
              className="inline-flex items-center gap-3 rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-foreground shadow-warm-card transition-shadow hover:shadow-lg"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              <Apple className="h-5 w-5" />
              Download for Mac
              <span className="rounded-md bg-accent-foreground/10 px-2 py-0.5 text-xs font-medium">
                .dmg
              </span>
            </motion.a>
          )}

          {/* Windows — coming soon */}
          {platform === "windows" && (
            <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-8 py-3 text-base font-semibold text-muted-foreground">
              <Monitor className="h-5 w-5" />
              Coming soon for Windows
            </div>
          )}

          {/* Linux — coming soon */}
          {platform === "linux" && (
            <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-8 py-3 text-base font-semibold text-muted-foreground">
              <Terminal className="h-5 w-5" />
              Coming soon for Linux
            </div>
          )}

          {/* Secondary platforms shown below the primary */}
          {platform === "macos" && (
            <p className="text-xs text-muted-foreground">
              Also coming soon for{" "}
              <span className="inline-flex items-center gap-1">
                <Monitor className="inline h-3 w-3" /> Windows
              </span>{" "}
              and{" "}
              <span className="inline-flex items-center gap-1">
                <Terminal className="inline h-3 w-3" /> Linux
              </span>
            </p>
          )}

          <Link
            href="/dashboard"
            className="mt-2 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Or use the web app &rarr;
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
