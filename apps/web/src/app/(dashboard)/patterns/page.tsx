"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Search, SlidersHorizontal, Layers, X, Pickaxe, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PatternCard } from "@/components/patterns/pattern-card";
const SOURCE_COLORS: Record<string, string> = {
  slack: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  gmail: "bg-red-500/10 text-red-600 border-red-500/20",
  linear: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  calendar: "bg-green-500/10 text-green-600 border-green-500/20",
};
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
  const [patterns, setPatterns] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mining, setMining] = useState(false);

  const loadPatterns = useCallback(() => {
    fetch("/api/patterns")
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        setPatterns(Array.isArray(data) ? data : []);
        setLoaded(true);
      })
      .catch(() => {
        setPatterns([]);
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    loadPatterns();
  }, [loadPatterns]);

  const handleMinePatterns = useCallback(() => {
    setMining(true);
    fetch("/api/patterns/mine", { method: "POST" })
      .then(() => loadPatterns())
      .catch((err) => console.error("Mining failed:", err))
      .finally(() => setMining(false));
  }, [loadPatterns]);

  const filtered = useMemo(() => {
    let result = [...patterns];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.steps.some((s: any) => s.eventType.toLowerCase().includes(q)),
      );
    }

    if (sourceFilter) {
      result = result.filter((p) => p.sources.includes(sourceFilter));
    }

    switch (sortBy) {
      case "frequency":
        result.sort((a, b) => b.frequency - a.frequency);
        break;
      case "recency":
        result.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
        break;
      default:
        result.sort((a, b) => b.compositeScore - a.compositeScore);
    }

    return result;
  }, [search, sourceFilter, sortBy, patterns]);

  const hasData = patterns.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Patterns</h1>
        <p className="text-sm text-muted-foreground">
          Recurring workflow patterns detected across your tools
        </p>
      </div>

      {/* Filters */}
      <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", !hasData && "opacity-40 pointer-events-none")}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search patterns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            disabled={!hasData}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {ALL_SOURCES.map((src) => (
              <button
                key={src}
                onClick={() => setSourceFilter(sourceFilter === src ? null : src)}
                disabled={!hasData}
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

          <Select value={sortBy} onValueChange={setSortBy} disabled={!hasData}>
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

          <button
            onClick={handleMinePatterns}
            disabled={mining}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {mining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pickaxe className="h-3.5 w-3.5" />}
            {mining ? "Mining..." : "Mine Patterns"}
          </button>
        </div>
      </div>

      {loaded && !hasData && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Layers className="h-12 w-12 text-muted-foreground/30" />
          <h2 className="font-display text-xl font-semibold mt-4">No patterns detected yet</h2>
          <p className="text-sm text-muted-foreground max-w-md mt-2">
            Connect your tools and run your first ingest to discover workflow patterns
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Link
              href="/connectors"
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
            >
              Connect Tools
            </Link>
            <button
              onClick={handleMinePatterns}
              disabled={mining}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
            >
              {mining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pickaxe className="h-3.5 w-3.5" />}
              {mining ? "Mining..." : "Mine Patterns"}
            </button>
          </div>
        </div>
      )}

      {hasData && (
        <>
          {/* Results count */}
          <p className="text-xs text-muted-foreground">
            {filtered.length} pattern{filtered.length !== 1 ? "s" : ""} found
          </p>

          {/* Grid */}
          <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((pattern) => (
                <div key={pattern.id} className="relative">
                  <PatternCard pattern={pattern} />
                  {pattern.userStatus === "confirmed" && (
                    <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-400">
                      <Check className="h-2.5 w-2.5" />
                      Confirmed
                    </span>
                  )}
                  {pattern.userStatus === "rejected" && (
                    <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-400">
                      <X className="h-2.5 w-2.5" />
                      Rejected
                    </span>
                  )}
                </div>
              ))}
            </AnimatePresence>
          </motion.div>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <SlidersHorizontal className="mb-3 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No patterns match your filters</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
