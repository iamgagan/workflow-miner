"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Plug, RefreshCw, Check, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isTauri } from "@/lib/desktop-bridge";

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
  /** Optional command/code block shown above the button */
  command?: string;
  /** Optional env-var hint list shown above the button */
  envVars?: Array<{ name: string; hint: string }>;
}

interface OnboardingWizardProps {
  onComplete?: () => void;
}

/**
 * First-run wizard. Renders different steps depending on whether the app is
 * running inside the Tauri desktop shell or as the hosted web app.
 *
 * Desktop steps (default for the macOS app):
 *   1. Welcome
 *   2. Connect a source — navigates to /connectors
 *   3. Sync — POSTs /api/sync?source=all and refreshes the dashboard
 *
 * Hosted steps (legacy):
 *   1. Welcome
 *   2. Configure env vars
 *   3. Run the CLI ingest command
 */
export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [desktop, setDesktop] = useState(false);

  // isTauri() requires window — defer to effect so SSR doesn't crash.
  useEffect(() => {
    setDesktop(isTauri());
  }, []);

  const dismiss = () => {
    localStorage.setItem(WIZARD_DISMISSED_KEY, "true");
    setCompleted(true);
    onComplete?.();
  };

  const desktopSteps: WizardStep[] = [
    {
      icon: Sparkles,
      title: "Welcome to Workflow Miner",
      description:
        "Workflow Miner watches the tools you already use — Gmail, Calendar, Slack, Linear — and surfaces the patterns that keep showing up. Everything runs locally on your Mac.",
      buttonLabel: "Get started",
      onClick: () => setStep(1),
    },
    {
      icon: Plug,
      title: "Connect a data source",
      description:
        "Pick a tool to connect. Google uses one-click OAuth via your default browser; Slack and Linear take a pasted token. Tokens live in the macOS Keychain — never on disk in plaintext.",
      buttonLabel: "Open connectors",
      onClick: () => {
        router.push("/connectors");
        // Don't dismiss yet — let the user finish step 3 from the dashboard.
        setStep(2);
      },
    },
    {
      icon: RefreshCw,
      title: "Run your first sync",
      description:
        "Once you've connected at least one source, click below to pull in your recent activity. The first sync usually finishes in under a minute.",
      buttonLabel: busy ? "Syncing…" : "Sync now",
      onClick: async () => {
        if (busy) return;
        setBusy(true);
        try {
          // Guard: if the user never completed step 2 (no connectors),
          // POSTing to /api/sync returns "skipped" for every source and
          // the user sees nothing happen. Route them back to /connectors
          // instead of letting the wizard sit on a silent no-op.
          const statusRes = await fetch("/api/connectors/status");
          const statusBody = await statusRes.json().catch(() => ({}));
          const connectors = (statusBody?.connectors ?? {}) as Record<
            string,
            { connected?: boolean }
          >;
          const anyConnected = Object.values(connectors).some(
            (c) => c?.connected === true,
          );
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

  const hostedSteps: WizardStep[] = [
    {
      icon: Sparkles,
      title: "Welcome to Workflow Miner",
      description:
        "Discover hidden patterns in your daily work. Workflow Miner observes your tools and surfaces repeatable workflows you can turn into reusable skills.",
      buttonLabel: "Get started",
      onClick: () => setStep(1),
    },
    {
      icon: Plug,
      title: "Configure credentials",
      description:
        "Add your Gmail credentials as environment variables so the ingestion pipeline can read your email metadata.",
      buttonLabel: "I've configured it",
      onClick: () => setStep(2),
      envVars: [
        { name: "GMAIL_CLIENT_ID", hint: "OAuth 2.0 client ID from Google Cloud Console" },
        { name: "GMAIL_CLIENT_SECRET", hint: "OAuth 2.0 client secret" },
        { name: "GMAIL_REFRESH_TOKEN", hint: "Refresh token from OAuth flow" },
      ],
    },
    {
      icon: Terminal,
      title: "Run your first ingest",
      description:
        "Run the CLI command below to pull events from all connected sources. This typically takes a few minutes depending on volume.",
      buttonLabel: "Done!",
      onClick: dismiss,
      command: "npx workflow-miner ingest --source all",
    },
  ];

  const steps = desktop ? desktopSteps : hostedSteps;

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

              {current.envVars && (
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

              {current.command && (
                <div className="mt-5 w-full rounded-lg border border-border bg-muted/50 px-4 py-3 text-left">
                  <code className="text-sm font-mono text-foreground">
                    {current.command}
                  </code>
                </div>
              )}

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

          {/* Step indicator dots */}
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
