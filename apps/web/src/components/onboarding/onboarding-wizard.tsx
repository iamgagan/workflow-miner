"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Plug, RefreshCw, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const WIZARD_DISMISSED_KEY = "onboarding-wizard-dismissed";

export function isWizardDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(WIZARD_DISMISSED_KEY) === "true";
}

interface WizardStep {
  icon: LucideIcon;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void | Promise<void>;
}

interface OnboardingWizardProps {
  onComplete?: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);

  const dismiss = () => {
    localStorage.setItem(WIZARD_DISMISSED_KEY, "true");
    setCompleted(true);
    onComplete?.();
  };

  const steps: WizardStep[] = [
    {
      icon: Sparkles,
      title: "Welcome to Company Brain",
      description:
        "The Company Brain watches the tools your team uses — Gmail, Calendar, Slack, Linear — and surfaces the patterns that keep showing up. It answers questions based on your organization's real operations.",
      buttonLabel: "Get started",
      onClick: () => setStep(1),
    },
    {
      icon: Plug,
      title: "Connect a data source",
      description:
        "Pick a tool to connect. Your organization's data will be securely embedded and isolated using Row Level Security.",
      buttonLabel: "Open connectors",
      onClick: () => {
        router.push("/connectors");
        setStep(2);
      },
    },
    {
      icon: RefreshCw,
      title: "Run your first sync",
      description:
        "Once you've connected at least one source, click below to pull in your recent activity. The background worker will generate embeddings automatically.",
      buttonLabel: busy ? "Syncing…" : "Sync now",
      onClick: async () => {
        if (busy) return;
        setBusy(true);
        try {
          const statusRes = await fetch("/api/connectors/status");
          const statusBody = await statusRes.json().catch(() => ({}));
          const connectors = (statusBody?.connectors ?? {}) as Record<string, { connected?: boolean }>;
          const anyConnected = Object.values(connectors).some((c) => c?.connected === true);
          if (!anyConnected) {
            router.push("/connectors");
            dismiss();
            return;
          }

          await fetch("/api/sync?source=all", { method: "POST" });
          router.refresh();
          dismiss();
        } finally {
          setBusy(false);
        }
      },
    },
  ];

  if (completed) return null;

  const current = steps[Math.min(step, steps.length - 1)];
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

              <Button
                size="lg"
                disabled={busy}
                className="mt-8 bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => {
                  void current.onClick();
                }}
              >
                {step === steps.length - 1 && !busy && (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                {current.buttonLabel}
              </Button>

              {step > 0 && (
                <button
                  type="button"
                  onClick={dismiss}
                  className="mt-4 text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Skip for now
                </button>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex items-center justify-center gap-2">
            {steps.map((_, i) => (
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
