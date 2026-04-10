"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Lightbulb,
  AlertTriangle,
  TrendingUp,
  X,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CoachNudge as CoachNudgeType } from "@/app/api/coach/route";

const NUDGE_ICONS = {
  reminder: Bell,
  suggestion: Lightbulb,
  warning: AlertTriangle,
  insight: TrendingUp,
} as const;

const NUDGE_COLORS = {
  reminder: "text-blue-500",
  suggestion: "text-green-500",
  warning: "text-amber-500",
  insight: "text-purple-500",
} as const;

const SNOOZE_KEY = "coach-snoozed-until";
const DISMISSED_KEY = "coach-dismissed-ids";

export function CoachNudge() {
  const [nudges, setNudges] = useState<CoachNudgeType[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  const isCoachEnabled = useCallback(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("coach-enabled") !== "false";
  }, []);

  const isSnoozed = useCallback(() => {
    if (typeof window === "undefined") return false;
    const until = localStorage.getItem(SNOOZE_KEY);
    if (!until) return false;
    return Date.now() < Number(until);
  }, []);

  const getDismissedIds = useCallback((): string[] => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!isCoachEnabled() || isSnoozed()) return;

    fetch("/api/coach")
      .then((res) => res.json())
      .then((data: CoachNudgeType[]) => {
        const dismissed = getDismissedIds();
        const filtered = data.filter((n) => !dismissed.includes(n.id));
        if (filtered.length > 0) {
          setNudges(filtered);
          setVisible(true);
        }
      })
      .catch(() => {
        // Silently fail — coach is non-critical
      });
  }, [isCoachEnabled, isSnoozed, getDismissedIds]);

  const handleDismiss = () => {
    const current = nudges[currentIndex];
    if (current) {
      const dismissed = getDismissedIds();
      localStorage.setItem(
        DISMISSED_KEY,
        JSON.stringify([...dismissed, current.id])
      );
    }

    if (currentIndex < nudges.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setVisible(false);
    }
  };

  const handleSnooze = () => {
    const thirtyMinutes = 30 * 60 * 1000;
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + thirtyMinutes));
    setVisible(false);
  };

  if (!visible || nudges.length === 0) return null;

  const current = nudges[currentIndex];
  const Icon = NUDGE_ICONS[current.type];
  const iconColor = NUDGE_COLORS[current.type];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 80, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 80, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-4 right-4 z-50 w-80"
        >
          <Card className="shadow-lg border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${iconColor}`} />
                  <CardTitle className="text-sm">{current.title}</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 -mt-1 -mr-2"
                  onClick={handleDismiss}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pb-3">
              <p className="text-sm text-muted-foreground">
                {current.message}
              </p>
            </CardContent>
            <CardFooter className="pt-0 gap-2">
              <Button variant="ghost" size="sm" onClick={handleSnooze}>
                <Clock className="h-3 w-3 mr-1" />
                Snooze
              </Button>
              {nudges.length > 1 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {currentIndex + 1} / {nudges.length}
                </span>
              )}
            </CardFooter>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
