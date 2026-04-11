"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Plug, Terminal, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const WIZARD_DISMISSED_KEY = "onboarding-wizard-dismissed";

const STEPS = [
  {
    icon: Sparkles,
    title: "Welcome to Workflow Miner",
    description:
      "Discover hidden patterns in your daily work. Workflow Miner observes your tools — email, calendar, project trackers — and surfaces repeatable workflows you can turn into reusable skills.",
    buttonLabel: "Get Started",
  },
  {
    icon: Plug,
    title: "Connect Your Tools",
    description:
      "Add your Gmail credentials as environment variables so the ingestion pipeline can read your email metadata.",
    buttonLabel: "I've configured it",
    envVars: [
      { name: "GMAIL_CLIENT_ID", hint: "OAuth 2.0 client ID from Google Cloud Console" },
      { name: "GMAIL_CLIENT_SECRET", hint: "OAuth 2.0 client secret" },
      { name: "GMAIL_REFRESH_TOKEN", hint: "Refresh token from OAuth flow" },
    ],
  },
  {
    icon: Terminal,
    title: "Run Your First Ingest",
    description:
      "Run the CLI command below to pull events from all connected sources. This typically takes a few minutes depending on volume.",
    buttonLabel: "Done!",
    command: "npx workflow-miner ingest --source all",
  },
] as const;

export function isWizardDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(WIZARD_DISMISSED_KEY) === "true";
}

export function OnboardingWizard({ onComplete }: { onComplete?: () => void }) {
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep((prev) => prev + 1);
    } else {
      localStorage.setItem(WIZARD_DISMISSED_KEY, "true");
      setCompleted(true);
      onComplete?.();
    }
  };

  if (completed) return null;

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mx-auto max-w-lg"
    >
      <Card className="shadow-warm-card overflow-hidden">
        <CardContent className="p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="flex flex-col items-center text-center"
            >
              <div className="mb-6 rounded-2xl bg-primary/10 p-4">
                <Icon className="h-8 w-8 text-primary" />
              </div>

              <h2 className="font-display text-2xl font-bold tracking-tight">
                {current.title}
              </h2>

              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {current.description}
              </p>

              {"envVars" in current && current.envVars && (
                <div className="mt-5 w-full space-y-2 text-left">
                  {current.envVars.map((v) => (
                    <div
                      key={v.name}
                      className="rounded-lg border border-border bg-muted/50 px-4 py-2.5"
                    >
                      <code className="text-sm font-semibold text-foreground">
                        {v.name}
                      </code>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {v.hint}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {"command" in current && current.command && (
                <div className="mt-5 w-full rounded-lg border border-border bg-muted/50 px-4 py-3 text-left">
                  <code className="text-sm font-mono text-foreground">
                    {current.command}
                  </code>
                </div>
              )}

              <Button
                size="lg"
                className="mt-8 bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleNext}
              >
                {step === STEPS.length - 1 && (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                {current.buttonLabel}
              </Button>
            </motion.div>
          </AnimatePresence>

          {/* Step indicator dots */}
          <div className="mt-8 flex items-center justify-center gap-2">
            {STEPS.map((_, i) => (
              <motion.div
                key={i}
                className={`h-2 rounded-full transition-colors ${
                  i === step
                    ? "bg-accent w-6"
                    : i < step
                      ? "bg-accent/40 w-2"
                      : "bg-muted-foreground/20 w-2"
                }`}
                layout
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
