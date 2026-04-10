"use client";

import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type PlaybackSpeed = 1 | 2 | 4;

interface ReplayControlsProps {
  isPlaying: boolean;
  speed: PlaybackSpeed;
  currentStep: number;
  totalSteps: number;
  onPlayPause: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onStepBack: () => void;
  onStepForward: () => void;
}

const SPEEDS: PlaybackSpeed[] = [1, 2, 4];

export function ReplayControls({
  isPlaying,
  speed,
  currentStep,
  totalSteps,
  onPlayPause,
  onSpeedChange,
  onStepBack,
  onStepForward,
}: ReplayControlsProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onStepBack}
          disabled={currentStep <= 0}
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onPlayPause}>
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onStepForward}
          disabled={currentStep >= totalSteps - 1}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      <span className="text-sm text-muted-foreground">
        Step {currentStep + 1} / {totalSteps}
      </span>

      <div className="flex items-center gap-1">
        {SPEEDS.map((s) => (
          <Badge
            key={s}
            variant={speed === s ? "default" : "secondary"}
            className={cn("cursor-pointer select-none")}
            onClick={() => onSpeedChange(s)}
          >
            {s}x
          </Badge>
        ))}
      </div>
    </div>
  );
}
