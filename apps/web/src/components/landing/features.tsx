"use client";

import { motion } from "framer-motion";
import { Search, CheckCircle, Rocket } from "lucide-react";
import type { ReactNode } from "react";

const features: { icon: ReactNode; title: string; description: string; step: string }[] = [
  {
    icon: <Search className="h-6 w-6" />,
    title: "Mine",
    step: "01",
    description:
      "Connect your tools and let the engine analyze your events. It groups activities into sessions and detects recurring sequences automatically.",
  },
  {
    icon: <CheckCircle className="h-6 w-6" />,
    title: "Review",
    step: "02",
    description:
      "Browse discovered patterns scored by frequency, impact, and automation potential. Approve the ones worth turning into skills.",
  },
  {
    icon: <Rocket className="h-6 w-6" />,
    title: "Deploy",
    step: "03",
    description:
      "Export approved patterns as skill packs — ready-to-use AI agent instructions you can plug into Claude Code, Copilot, or your own tooling.",
  },
];

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.15 },
  },
};

const item = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export function Features() {
  return (
    <section id="how-it-works" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            How it works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Three steps from raw activity data to deployable AI skills.
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-16 grid gap-8 md:grid-cols-3"
        >
          {features.map((f) => (
            <motion.div
              key={f.title}
              variants={item}
              className="group relative rounded-2xl border border-border/50 bg-card/50 p-8 backdrop-blur-sm transition-colors hover:border-border"
            >
              <span className="absolute right-6 top-6 text-5xl font-bold text-muted/50">
                {f.step}
              </span>
              <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                {f.icon}
              </div>
              <h3 className="text-xl font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
