"use client";

import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PatternCard } from "@/components/patterns/pattern-card";
import { MOCK_PATTERNS, SOURCE_COLORS } from "@/lib/mock-patterns";
import { cn } from "@/lib/utils";

const ALL_SOURCES = ["slack", "gmail", "linear", "calendar"] as const;
const SORT_OPTIONS = [
  { value: "score", label: "Composite Score" },
  { value: "frequency", label: "Frequency" },
  { value: "recency", label: "Most Recent" },
] as const;

export default function PatternsPage() {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("score");

  const filtered = useMemo(() => {
    let patterns = [...MOCK_PATTERNS];

    if (search) {
      const q = search.toLowerCase();
      patterns = patterns.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.steps.some((s) => s.eventType.toLowerCase().includes(q)),
      );
    }

    if (sourceFilter) {
      patterns = patterns.filter((p) => p.sources.includes(sourceFilter));
    }

    switch (sortBy) {
      case "frequency":
        patterns.sort((a, b) => b.frequency - a.frequency);
        break;
      case "recency":
        patterns.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
        break;
      default:
        patterns.sort((a, b) => b.compositeScore - a.compositeScore);
    }

    return patterns;
  }, [search, sourceFilter, sortBy]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Patterns</h1>
        <p className="text-sm text-muted-foreground">
          Recurring workflow patterns detected across your tools
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search patterns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {ALL_SOURCES.map((src) => (
              <button
                key={src}
                onClick={() => setSourceFilter(sourceFilter === src ? null : src)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center transition-transform hover:scale-105"
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "cursor-pointer capitalize transition-all text-xs",
                    sourceFilter === src
                      ? SOURCE_COLORS[src]
                      : "opacity-40 hover:opacity-70",
                  )}
                >
                  {src}
                </Badge>
              </button>
            ))}
          </div>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[160px]">
              <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} pattern{filtered.length !== 1 ? "s" : ""} found
      </p>

      {/* Grid */}
      <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {filtered.map((pattern) => (
            <PatternCard key={pattern.id} pattern={pattern} />
          ))}
        </AnimatePresence>
      </motion.div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <SlidersHorizontal className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No patterns match your filters</p>
        </div>
      )}
    </div>
  );
}
