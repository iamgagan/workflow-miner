"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative flex min-h-[85vh] flex-col items-center justify-center px-4 text-center">
      {/* Subtle warm radial glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="relative z-10"
      >
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="mb-8 text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground"
        >
          Zero setup &mdash; start mining patterns instantly
        </motion.p>

        <h1 className="mx-auto max-w-4xl font-display text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl lg:text-8xl">
          Mine Your{" "}
          <span className="text-accent">Workflows</span>
        </h1>

        <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
          The observability layer for AI automation. Workflow Miner watches
          your tools, discovers the patterns your team actually repeats, and
          exports them to Claude, n8n, Zapier — or any runtime you want.
        </p>

        <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="gap-2 rounded-full bg-accent px-8 text-base text-accent-foreground hover:bg-accent/90">
            <Link href="/dashboard">
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="rounded-full px-8 text-base"
          >
            <a href="#how-it-works">See how it works</a>
          </Button>
        </div>
      </motion.div>
    </section>
  );
}
