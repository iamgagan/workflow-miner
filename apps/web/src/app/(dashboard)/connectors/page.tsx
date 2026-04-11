"use client";

import { useState } from "react";
import { Mail, Calendar, MessageSquare, GitBranch, RefreshCw, X, ExternalLink, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ComponentType } from "react";

interface ConnectorData {
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  status: "connected" | "not_configured";
  lastSync?: string;
  events?: number;
  setupHint?: string;
  setupSteps?: { title: string; description: string; code?: string; link?: string }[];
  envVars?: string[];
}

const connectors: ConnectorData[] = [
  {
    name: "Gmail",
    description: "Email threads and conversations",
    icon: Mail,
    color: "#ef4444",
    status: "connected",
    lastSync: "2 hours ago",
    events: 104,
  },
  {
    name: "Google Calendar",
    description: "Meetings and calendar events",
    icon: Calendar,
    color: "#3b82f6",
    status: "connected",
    lastSync: "2 hours ago",
    events: 24,
  },
  {
    name: "Slack",
    description: "Team messages and channels",
    icon: MessageSquare,
    color: "#a855f7",
    status: "not_configured",
    setupHint: "Connect your Slack workspace to ingest messages and channel activity",
    envVars: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
    setupSteps: [
      {
        title: "Create a Slack App",
        description: "Go to the Slack API dashboard and create a new app for your workspace.",
        link: "https://api.slack.com/apps",
      },
      {
        title: "Add Bot Scopes",
        description: "Under OAuth & Permissions, add these bot token scopes: channels:history, channels:read, users:read",
      },
      {
        title: "Install to Workspace",
        description: "Click 'Install to Workspace' and authorize the app. Copy the Bot User OAuth Token.",
      },
      {
        title: "Add Environment Variables",
        description: "Add these to your .env file at the project root:",
        code: "SLACK_BOT_TOKEN=xoxb-your-token\nSLACK_SIGNING_SECRET=your-signing-secret",
      },
      {
        title: "Run Ingest",
        description: "Test the connection with a dry run:",
        code: "cd packages/engine && node dist/cli/index.js ingest --source slack --dry-run",
      },
    ],
  },
  {
    name: "Linear",
    description: "Issues and project tracking",
    icon: GitBranch,
    color: "#6366f1",
    status: "not_configured",
    setupHint: "Connect Linear to track issues, projects, and team activity",
    envVars: ["LINEAR_API_KEY"],
    setupSteps: [
      {
        title: "Generate an API Key",
        description: "Go to Linear Settings → API and create a personal API key.",
        link: "https://linear.app/settings/api",
      },
      {
        title: "Add Environment Variable",
        description: "Add the key to your .env file at the project root:",
        code: "LINEAR_API_KEY=lin_api_your-key-here",
      },
      {
        title: "Run Ingest",
        description: "Test the connection with a dry run:",
        code: "cd packages/engine && node dist/cli/index.js ingest --source linear --dry-run",
      },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function SetupDialog({
  connector,
  onClose,
}: {
  connector: ConnectorData;
  onClose: () => void;
}) {
  const Icon = connector.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-6 shadow-warm-card"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: connector.color + "1a" }}
          >
            <span style={{ color: connector.color }}>
              <Icon className="h-5 w-5" />
            </span>
          </div>
          <div>
            <h2 className="text-lg font-display font-bold">Configure {connector.name}</h2>
            <p className="text-sm text-muted-foreground">{connector.description}</p>
          </div>
        </div>

        {connector.envVars && (
          <div className="mb-6 rounded-lg border bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Required environment variables:</p>
            <div className="flex flex-wrap gap-1.5">
              {connector.envVars.map((v) => (
                <code key={v} className="rounded bg-background px-2 py-0.5 text-xs font-mono border">
                  {v}
                </code>
              ))}
            </div>
          </div>
        )}

        <ol className="space-y-5">
          {connector.setupSteps?.map((step, i) => (
            <li key={i} className="flex gap-3">
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white mt-0.5"
                style={{ backgroundColor: connector.color }}
              >
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{step.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>
                {step.link && (
                  <a
                    href={step.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {step.code && (
                  <div className="relative mt-2 rounded-lg border bg-background p-3 pr-10">
                    <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                      {step.code}
                    </pre>
                    <CopyButton text={step.code} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function ConnectorsPage() {
  const [configuring, setConfiguring] = useState<ConnectorData | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Connectors</h1>
        <p className="text-muted-foreground">
          Manage your data source integrations
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {connectors.map((connector, index) => {
          const Icon = connector.icon;
          const isConnected = connector.status === "connected";

          return (
            <motion.div
              key={connector.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className="rounded-xl border bg-card p-6 shadow-warm-card"
            >
              <div className="flex items-start gap-4">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: connector.color + "1a" }}
                >
                  <span style={{ color: connector.color }}>
                    <Icon className="h-6 w-6" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold">{connector.name}</h3>
                    {isConnected ? (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        Not Configured
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connector.description}
                  </p>

                  {isConnected ? (
                    <div className="mt-4 flex items-center justify-between">
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p>Last synced: {connector.lastSync}</p>
                        <p>{connector.events} events</p>
                      </div>
                      <button className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                        <RefreshCw className="h-3.5 w-3.5" />
                        Sync Now
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <p className="text-xs text-muted-foreground">
                        {connector.setupHint}
                      </p>
                      <button
                        onClick={() => setConfiguring(connector)}
                        className="mt-3 inline-flex items-center rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
                      >
                        Configure
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {configuring && (
          <SetupDialog
            connector={configuring}
            onClose={() => setConfiguring(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
