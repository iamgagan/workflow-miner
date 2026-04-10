"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

const mockEvents = [
  { id: 1, source: "GitHub", action: "PR opened", time: "9:02 AM" },
  { id: 2, source: "Slack", action: "Thread reply in #eng", time: "9:05 AM" },
  { id: 3, source: "Calendar", action: "Standup meeting", time: "9:15 AM" },
  { id: 4, source: "GitHub", action: "PR review requested", time: "9:32 AM" },
  { id: 5, source: "Slack", action: "DM to reviewer", time: "9:34 AM" },
  { id: 6, source: "GitHub", action: "PR merged", time: "10:10 AM" },
];

const sourceColors: Record<string, string> = {
  GitHub: "text-emerald-400",
  Slack: "text-blue-400",
  Calendar: "text-purple-400",
};

const sourceBg: Record<string, string> = {
  GitHub: "bg-emerald-400/10",
  Slack: "bg-blue-400/10",
  Calendar: "bg-purple-400/10",
};

export function PatternDemo() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [patternFound, setPatternFound] = useState(false);

  useEffect(() => {
    if (visibleCount < mockEvents.length) {
      const timer = setTimeout(() => setVisibleCount((c) => c + 1), 600);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => setPatternFound(true), 800);
      return () => clearTimeout(timer);
    }
  }, [visibleCount]);

  useEffect(() => {
    if (!patternFound) return;
    const timer = setTimeout(() => {
      setVisibleCount(0);
      setPatternFound(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, [patternFound]);

  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Watch patterns emerge
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Events stream in from your connected tools. The miner spots the
            sequences you repeat every day.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative mx-auto mt-16 max-w-2xl overflow-hidden rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm"
        >
          {/* Header bar */}
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-3">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            <span className="ml-3 text-xs text-muted-foreground">
              workflow-miner — live feed
            </span>
          </div>

          {/* Event feed */}
          <div className="min-h-[320px] p-5">
            <div className="space-y-2">
              <AnimatePresence>
                {mockEvents.slice(0, visibleCount).map((event) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: -20, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: "auto" }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
                  >
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      {event.time}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${sourceBg[event.source]} ${sourceColors[event.source]}`}
                    >
                      {event.source}
                    </span>
                    <span className="text-foreground/80">{event.action}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Pattern found overlay */}
            <AnimatePresence>
              {patternFound && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.4 }}
                  className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">
                      Pattern discovered
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      &quot;PR Review Workflow&quot;
                    </span>{" "}
                    — Open PR → Notify on Slack → Standup → Review → Merge.
                    Seen 14 times in the last 30 days.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
