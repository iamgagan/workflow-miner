"use client";

import { useEffect, useState } from "react";
import { Activity, GitBranch, Sparkles, Database } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { ActivityChart } from "@/components/activity-chart";
import { RecentPatterns } from "@/components/recent-patterns";
import { SourceStatus } from "@/components/source-status";
import { ActivityTimeline } from "@/components/activity-timeline";

const MOCK_STATS = [
  {
    title: "Total Events",
    value: 5700,
    icon: Activity,
    description: "+12% from last week",
  },
  {
    title: "Active Patterns",
    value: 23,
    icon: GitBranch,
    description: "5 new patterns detected",
  },
  {
    title: "Skill Exports",
    value: 8,
    icon: Sparkles,
    description: "3 pending review",
  },
  {
    title: "Data Sources",
    value: 3,
    suffix: " / 4",
    icon: Database,
    description: "1 disconnected",
  },
];

interface DashboardStats {
  totalEvents: number;
  activePatterns: number;
  skillsExported: number;
  dataSources: number;
  totalSources: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState(MOCK_STATS);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then((data: DashboardStats) => {
        setStats([
          {
            title: "Total Events",
            value: data.totalEvents,
            icon: Activity,
            description: "+12% from last week",
          },
          {
            title: "Active Patterns",
            value: data.activePatterns,
            icon: GitBranch,
            description: `${data.activePatterns} patterns detected`,
          },
          {
            title: "Skill Exports",
            value: data.skillsExported,
            icon: Sparkles,
            description: "exported skills",
          },
          {
            title: "Data Sources",
            value: data.dataSources,
            suffix: ` / ${data.totalSources}`,
            icon: Database,
            description: `${data.totalSources - data.dataSources} disconnected`,
          },
        ]);
      })
      .catch(() => {
        // Keep mock stats on error
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your workflow mining overview
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
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
    </div>
  );
}
