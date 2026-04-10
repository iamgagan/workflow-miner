"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkflowPlayer } from "@/components/replay/workflow-player";
import { EventCard, type ReplayEvent } from "@/components/replay/event-card";
import {
  ReplayControls,
  type PlaybackSpeed,
} from "@/components/replay/replay-controls";

// ── Mock replay sequences ──────────────────────────────────────────

const SEQUENCES: { name: string; events: ReplayEvent[] }[] = [
  {
    name: "Bug Report to Deploy",
    events: [
      {
        id: "b1",
        source: "slack",
        title: "#bugs: crash on login",
        summary: "User reported login crash on mobile",
        timestamp: "9:02 AM",
        detail:
          "Sasha posted a screenshot of the crash screen and console logs showing a null reference in the OAuth callback handler.",
      },
      {
        id: "b2",
        source: "linear",
        title: "BUG-421 created",
        summary: "Triaged as P1 and assigned to Dylan",
        timestamp: "9:08 AM",
        detail:
          "Linear issue created from Slack thread. Labels: bug, auth, mobile. Sprint: current.",
      },
      {
        id: "b3",
        source: "calendar",
        title: "Quick sync: login crash",
        summary: "15-min huddle with Dylan and QA",
        timestamp: "9:30 AM",
        detail:
          "Agreed on fix approach: add null-check guard in OAuth callback and add regression test.",
      },
      {
        id: "b4",
        source: "linear",
        title: "BUG-421 → In Review",
        summary: "PR #187 opened with fix",
        timestamp: "10:45 AM",
        detail:
          "Dylan opened PR with the guard clause fix plus two new integration tests covering the edge case.",
      },
      {
        id: "b5",
        source: "gmail",
        title: "Deploy notification",
        summary: "v2.3.1 deployed to production",
        timestamp: "11:20 AM",
        detail:
          "CI/CD pipeline completed. All 247 tests passed. Canary checks green. Fix verified in production.",
      },
    ],
  },
  {
    name: "Feature Kickoff",
    events: [
      {
        id: "f1",
        source: "gmail",
        title: "Product brief: Dark Mode",
        summary: "PM shared feature brief for dark mode",
        timestamp: "Mon 8:00 AM",
        detail:
          "Covers user research findings, competitive analysis, and proposed scope. Target: Q2 release.",
      },
      {
        id: "f2",
        source: "calendar",
        title: "Design review meeting",
        summary: "Reviewed Figma mocks with design team",
        timestamp: "Mon 2:00 PM",
        detail:
          "Design presented three theme variants. Team voted for the high-contrast option with system preference detection.",
      },
      {
        id: "f3",
        source: "linear",
        title: "FEAT-88 created",
        summary: "Epic with 6 sub-tasks created",
        timestamp: "Tue 9:15 AM",
        detail:
          "Sub-tasks: theme context, CSS variables, component audit, settings toggle, persistence, QA pass.",
      },
      {
        id: "f4",
        source: "slack",
        title: "#frontend: theme tokens",
        summary: "Discussion on CSS variable naming",
        timestamp: "Tue 11:30 AM",
        detail:
          "Agreed on --color-bg-primary / --color-text-primary convention. Will use next-themes for system detection.",
      },
      {
        id: "f5",
        source: "linear",
        title: "FEAT-88 → In Progress",
        summary: "First PR merged: theme context",
        timestamp: "Wed 4:00 PM",
        detail:
          "ThemeProvider with next-themes integration merged. All existing components render correctly in both modes.",
      },
      {
        id: "f6",
        source: "gmail",
        title: "Stakeholder update",
        summary: "Weekly update email sent to PM",
        timestamp: "Fri 5:00 PM",
        detail:
          "Progress: 3 of 6 sub-tasks complete. On track for Q2 target. No blockers.",
      },
    ],
  },
  {
    name: "Incident Response",
    events: [
      {
        id: "i1",
        source: "slack",
        title: "#alerts: DB latency spike",
        summary: "PagerDuty triggered for p95 > 2s",
        timestamp: "3:12 AM",
        detail:
          "Automated alert from monitoring. PostgreSQL p95 query latency jumped from 120ms to 2.4s over 5 minutes.",
      },
      {
        id: "i2",
        source: "calendar",
        title: "Incident bridge",
        summary: "On-call joined war room",
        timestamp: "3:20 AM",
        detail:
          "Alex (on-call) and Priya (DB lead) joined the incident bridge. Initial investigation pointed to a long-running migration.",
      },
      {
        id: "i3",
        source: "linear",
        title: "INC-12 opened",
        summary: "Severity 1 incident tracked",
        timestamp: "3:25 AM",
        detail:
          "Incident created with timeline. Root cause identified: an ALTER TABLE adding an index locked the users table.",
      },
      {
        id: "i4",
        source: "slack",
        title: "#incidents: mitigation applied",
        summary: "Killed blocking query, latency recovered",
        timestamp: "3:38 AM",
        detail:
          "Priya killed the blocking ALTER statement. p95 dropped back to 140ms within 2 minutes. Migration rescheduled for maintenance window.",
      },
      {
        id: "i5",
        source: "gmail",
        title: "Incident postmortem",
        summary: "Postmortem doc shared with team",
        timestamp: "10:00 AM",
        detail:
          "Action items: add migration lock timeout, pre-flight checks for large table DDL, update runbook for DB incidents.",
      },
    ],
  },
];

// ── Page ────────────────────────────────────────────────────────────

export default function ReplayPage() {
  const [selectedSequence, setSelectedSequence] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const events = SEQUENCES[selectedSequence].events;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Auto-advance when playing
  useEffect(() => {
    clearTimer();
    if (!isPlaying) return;
    if (currentStep >= events.length - 1) {
      setIsPlaying(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      setCurrentStep((s) => s + 1);
    }, 1200 / speed);
    return clearTimer;
  }, [isPlaying, currentStep, speed, events.length, clearTimer]);

  const handleSequenceChange = (index: number) => {
    setSelectedSequence(index);
    setCurrentStep(0);
    setIsPlaying(false);
    setExpandedEvent(null);
  };

  const handleStepClick = (index: number) => {
    setCurrentStep(index);
    setIsPlaying(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workflow Replay</h1>
        <p className="text-muted-foreground">
          Step through captured workflow sequences to see how work moves across
          tools.
        </p>
      </div>

      {/* Sequence selector */}
      <div className="flex gap-2">
        {SEQUENCES.map((seq, i) => (
          <button
            key={seq.name}
            onClick={() => handleSequenceChange(i)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              i === selectedSequence
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {seq.name}
          </button>
        ))}
      </div>

      {/* Timeline visualization */}
      <WorkflowPlayer
        events={events}
        currentStep={currentStep}
        onStepClick={handleStepClick}
      />

      {/* Controls */}
      <ReplayControls
        isPlaying={isPlaying}
        speed={speed}
        currentStep={currentStep}
        totalSteps={events.length}
        onPlayPause={() => setIsPlaying((p) => !p)}
        onSpeedChange={setSpeed}
        onStepBack={() => {
          setCurrentStep((s) => Math.max(0, s - 1));
          setIsPlaying(false);
        }}
        onStepForward={() => {
          setCurrentStep((s) => Math.min(events.length - 1, s + 1));
          setIsPlaying(false);
        }}
      />

      {/* Event list */}
      <div className="space-y-3">
        {events.map((event, i) => (
          <EventCard
            key={event.id}
            event={event}
            isActive={i === currentStep}
            isExpanded={expandedEvent === event.id}
            onToggle={() =>
              setExpandedEvent(expandedEvent === event.id ? null : event.id)
            }
            index={i}
          />
        ))}
      </div>
    </div>
  );
}
