"use client";

import { useEffect, useState } from "react";
import { Activity, GitBranch, Sparkles, Database, Inbox } from "lucide-react";
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

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardDismissed, setWizardDismissed] = useState(true);

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
