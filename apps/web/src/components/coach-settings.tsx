"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const COACH_KEY = "coach-enabled";

export function CoachSettings() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(COACH_KEY);
    if (stored !== null) {
      setEnabled(stored !== "false");
    }
  }, []);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    localStorage.setItem(COACH_KEY, String(checked));
  };

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label htmlFor="coach-toggle" className="text-sm font-medium">
          Coach Mode
        </Label>
        <p className="text-sm text-muted-foreground">
          Get proactive workflow nudges on the dashboard
        </p>
      </div>
      <Switch
        id="coach-toggle"
        checked={enabled}
        onCheckedChange={handleToggle}
      />
    </div>
  );
}
