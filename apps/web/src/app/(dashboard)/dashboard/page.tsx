"use client";

import { useEffect, useState } from "react";
import { Activity, GitBranch, Sparkles, Database, Inbox, Mail, X } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { ActivityChart } from "@/components/activity-chart";
import { RecentPatterns } from "@/components/recent-patterns";
import { SourceStatus } from "@/components/source-status";
import { ActivityTimeline } from "@/components/activity-timeline";
import { CoachNudge } from "@/components/coach-nudge";
import {
  OnboardingWizard,
  isWizardDismissed,
} from "@/components/onboarding/onboarding-wizard";

interface DigestCheck {
  available: boolean;
  weekStart: string;
  weekEnd: string;
  eventCount: number;
  sourceCount: number;
}

interface DashboardStats {
  totalEvents: number;
  activePatterns: number;
  skillsExported: number;
  dataSources: number;
  totalSources: number;
  /** Real week-over-week delta computed by /api/dashboard. null when there's
   * no previous-week baseline yet. */
  eventsDeltaPct: number | null;
  /** ISO timestamp of the most recent ingest. null on a fresh brain. */
  lastIngestAt: string | null;
}

function relativeTimeLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function eventsDescription(data: DashboardStats): string {
  if (data.totalEvents === 0) return "No events ingested yet";
  if (data.eventsDeltaPct === null) {
    return data.lastIngestAt
      ? `Last ingest ${relativeTimeLabel(data.lastIngestAt)}`
      : "No previous-week baseline";
  }
  const sign = data.eventsDeltaPct > 0 ? "+" : "";
  return `${sign}${data.eventsDeltaPct}% vs last week`;
}

function buildStatCards(data: DashboardStats) {
  const connectedCount = data.dataSources;
  const disconnectedCount = data.totalSources - data.dataSources;

  return [
    {
      title: "Total Events",
      value: data.totalEvents,
      icon: Activity,
      description: eventsDescription(data),
    },
    {
      title: "Active Patterns",
      value: data.activePatterns,
      icon: GitBranch,
      description:
        data.activePatterns === 0
          ? "Run Mine Patterns to detect"
          : `${data.activePatterns} workflow${data.activePatterns === 1 ? "" : "s"} mined`,
    },
    {
      title: "Skill Exports",
      value: data.skillsExported,
      icon: Sparkles,
      description:
        data.skillsExported === 0
          ? "No skills exported yet"
          : `${data.skillsExported} download${data.skillsExported === 1 ? "" : "s"}`,
    },
    {
      title: "Data Sources",
      value: data.dataSources,
      suffix: ` / ${data.totalSources}`,
      icon: Database,
      description:
        connectedCount === 0
          ? "Connect a source to begin"
          : disconnectedCount === 0
            ? "All sources connected"
            : `${disconnectedCount} not connected`,
    },
  ];
}

const DIGEST_VIEWED_KEY = "wm:digestLastViewed";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardDismissed, setWizardDismissed] = useState(true);
  const [digest, setDigest] = useState<DigestCheck | null>(null);
  const [digestDismissed, setDigestDismissed] = useState(false);

  useEffect(() => {
    setWizardDismissed(isWizardDismissed());
  }, []);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data: DashboardStats) => {
        setStats(data);
      })
      .catch(() => {
        setStats({
          totalEvents: 0,
          activePatterns: 0,
          skillsExported: 0,
          dataSources: 0,
          totalSources: 4,
          eventsDeltaPct: null,
          lastIngestAt: null,
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const lastViewed = localStorage.getItem(DIGEST_VIEWED_KEY) ?? "";
    const url = `/api/digest/check${lastViewed ? `?lastViewed=${encodeURIComponent(lastViewed)}` : ""}`;
    fetch(url)
      .then((res) => res.ok ? res.json() : null)
      .then((data: DigestCheck | null) => {
        if (data?.available) setDigest(data);
      })
      .catch(() => {});
  }, []);

  const handleViewDigest = () => {
    localStorage.setItem(DIGEST_VIEWED_KEY, new Date().toISOString());
    setDigestDismissed(true);
  };

  const handleDismissDigest = () => {
    localStorage.setItem(DIGEST_VIEWED_KEY, new Date().toISOString());
    setDigestDismissed(true);
  };

  const isEmpty = stats !== null && stats.totalEvents === 0;
  const showWizard = isEmpty && !wizardDismissed;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your workflow mining overview
        </p>
      </div>

      {digest && !digestDismissed && (
        <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-800 dark:bg-blue-950/40">
          <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300">
            <Mail className="h-4 w-4 shrink-0" />
            <span>
              Weekly digest ready &mdash;{" "}
              <strong>{digest.eventCount} event{digest.eventCount !== 1 ? "s" : ""}</strong>{" "}
              across{" "}
              <strong>{digest.sourceCount} source{digest.sourceCount !== 1 ? "s" : ""}</strong>
            </span>
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-2">
            <a
              href="/api/digest"
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleViewDigest}
              className="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-200"
            >
              View digest
            </a>
            <button
              onClick={handleDismissDigest}
              className="rounded p-0.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      ) : showWizard ? (
        <OnboardingWizard onComplete={() => setWizardDismissed(true)} />
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card p-12 shadow-warm-card">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Inbox className="h-7 w-7 text-primary" />
          </div>
          <h2 className="mt-4 font-display text-xl font-semibold tracking-tight">
            No events yet
          </h2>
          <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
            Run your first ingest to get started. Once events flow in, your
            dashboard will light up with patterns, stats, and insights.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats && buildStatCards(stats).map((stat, i) => (
              <StatCard key={stat.title} index={i} {...stat} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <ActivityChart />
            </div>
            <div className="lg:col-span-2">
              <RecentPatterns />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SourceStatus />
            </div>
            <div className="lg:col-span-1">
              <ActivityTimeline />
            </div>
          </div>

          <CoachNudge />
        </>
      )}
    </div>
  );
}
