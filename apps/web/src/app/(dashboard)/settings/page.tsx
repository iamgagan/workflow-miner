"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, Settings, Unplug, Trash2, Sparkles, Key, Cpu, FolderOpen } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { NotificationPermission } from "@/components/notification-permission";

interface QuotaStatus {
  monthly_quota_tokens: number;
  used_this_period: number;
  period_resets_in_days: number;
}

export default function SettingsPage() {
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [disconnecting, setDisconnecting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [dreamStatus, setDreamStatus] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/devices/status");
        if (!res.ok) {
          // 401 = cloud mode (no device token, expected); 503 = first-launch
          // proxy reachability issue — surface only the latter.
          const data = await res.json().catch(() => ({}));
          if (res.status === 503 && !cancelled) {
            setQuotaError(data.hint ?? data.error ?? "AI features unreachable");
          }
          return;
        }
        const data = (await res.json()) as QuotaStatus;
        if (!cancelled) setQuota(data);
      } catch (err) {
        if (!cancelled) {
          setQuotaError(err instanceof Error ? err.message : "fetch failed");
        }
      }
    }
    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function runDreamCycle() {
    setDreamStatus("Running…");
    const res = await fetch("/api/dream/run", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setDreamStatus(`Error: ${data.error}`);
      return;
    }
    if (data.mode === "desktop") {
      setDreamStatus(
        `Done. Enriched ${data.pagesEnriched} pages, backfilled ${data.timelineEmbeddingsBackfilled} timeline embeddings.`,
      );
    } else {
      setDreamStatus(`Dispatched (event ${data.eventId})`);
    }
  }

  async function runExport() {
    setExportStatus("Running…");
    const res = await fetch("/api/export/run", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setExportStatus(`Error: ${data.error}`);
      return;
    }
    if (data.mode === "desktop") {
      setExportStatus(
        `Exported ${data.exported} pages → ${data.outputDir}${data.skipped > 0 ? ` (${data.skipped} skipped)` : ""}`,
      );
    } else {
      setExportStatus(`Dispatched (event ${data.eventId})`);
    }
  }

  const handleDisconnectAll = async () => {
    const ok = window.confirm(
      "Disconnect all sources? This will remove saved credentials for Google, Slack, and Linear. You can reconnect them at any time.",
    );
    if (!ok) return;
    setDisconnecting(true);
    try {
      for (const provider of ["google", "slack", "linear"] as const) {
        await fetch(`/api/connectors/manual-token?provider=${provider}`, {
          method: "DELETE",
        });
      }
      window.alert("All sources disconnected.");
    } catch (err) {
      window.alert(`Failed to disconnect: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleWipeBrain = async () => {
    const ok = window.confirm(
      "Wipe local brain? This permanently deletes all timeline events, patterns, and activity logs. This cannot be undone.",
    );
    if (!ok) return;
    setWiping(true);
    try {
      const res = await fetch("/api/admin/reset-brain", { method: "POST" });
      if (!res.ok) {
        const body = await res.text();
        window.alert(`Wipe failed: ${body}`);
        return;
      }
      window.alert("Local brain wiped successfully.");
    } catch (err) {
      window.alert(`Wipe failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8 text-primary" />
        <div>
          <h1 className="font-display text-3xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage notifications and preferences
          </p>
        </div>
      </div>

      <NotificationPermission />

      <Card className="shadow-warm-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Quiet Hours
          </CardTitle>
          <CardDescription>
            Pause notifications during specific hours so you can focus or rest.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-hours">Enable quiet hours</Label>
            <Switch
              id="quiet-hours"
              checked={quietHoursEnabled}
              onCheckedChange={setQuietHoursEnabled}
            />
          </div>
          {quietHoursEnabled && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="quiet-start" className="text-muted-foreground">
                  From
                </Label>
                <input
                  id="quiet-start"
                  type="time"
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                  className="rounded-md border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="quiet-end" className="text-muted-foreground">
                  To
                </Label>
                <input
                  id="quiet-end"
                  type="time"
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  className="rounded-md border bg-background px-3 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="shadow-warm-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            API Keys
          </CardTitle>
          <CardDescription>
            Generate keys for the MCP server (Claude Code, Cursor, etc).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/api-keys" className="text-sm underline">
            Manage API keys →
          </Link>
        </CardContent>
      </Card>

      {(quota || quotaError) && (
        <Card className="shadow-warm-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              AI Features
            </CardTitle>
            <CardDescription>
              Pattern naming, classification, and the Company Brain chat use a shared monthly quota
              that resets every 30 days. No setup required — your install is registered automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quota ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm">
                    <span className="font-mono">{quota.used_this_period.toLocaleString()}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      / {quota.monthly_quota_tokens.toLocaleString()} tokens
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Resets in {quota.period_resets_in_days} day{quota.period_resets_in_days === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      "h-full transition-all " +
                      (quota.used_this_period / quota.monthly_quota_tokens > 0.9
                        ? "bg-destructive"
                        : quota.used_this_period / quota.monthly_quota_tokens > 0.7
                          ? "bg-yellow-500"
                          : "bg-primary")
                    }
                    style={{
                      width: `${Math.min(100, (quota.used_this_period / quota.monthly_quota_tokens) * 100)}%`,
                    }}
                  />
                </div>
                {quota.used_this_period / quota.monthly_quota_tokens > 0.9 ? (
                  <p className="text-xs text-destructive">
                    You&rsquo;re close to the monthly cap. AI features will pause until the period resets.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs font-mono text-muted-foreground">
                {quotaError ?? "loading…"}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="shadow-warm-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Dream Cycle
          </CardTitle>
          <CardDescription>
            Manually trigger the LLM enrichment pass — refreshes compiled summaries on touched
            pages, extracts entities, and backfills timeline embeddings so the Brain chat has
            something to search.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={runDreamCycle}>Run Dream Cycle now</Button>
          {dreamStatus ? (
            <p className="text-xs font-mono text-muted-foreground">{dreamStatus}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-warm-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            Markdown export
          </CardTitle>
          <CardDescription>
            Snapshot the brain to disk as gbrain-format markdown. On desktop, files land in{" "}
            <code className="text-xs">~/Documents/Workflow Miner/export/</code>. On the cloud
            deployment, this pushes to the GitHub repo configured by{" "}
            <code className="text-xs">GITHUB_EXPORT_PAT</code> +{" "}
            <code className="text-xs">GITHUB_EXPORT_REPO</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={runExport}>Run export now</Button>
          {exportStatus ? (
            <p className="text-xs font-mono text-muted-foreground">{exportStatus}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-300 shadow-warm-card dark:border-red-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Irreversible actions. These cannot be undone — proceed with caution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/20">
            <div className="min-w-0">
              <p className="text-sm font-medium text-destructive">Disconnect all sources</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Clears saved credentials for Google, Slack, and Linear. Existing brain data is kept.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-red-300 text-destructive hover:bg-red-50 hover:text-destructive dark:border-red-800 dark:hover:bg-red-950"
              onClick={handleDisconnectAll}
              disabled={disconnecting}
            >
              <Unplug className="mr-1.5 h-4 w-4" />
              {disconnecting ? "Disconnecting..." : "Disconnect all"}
            </Button>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/20">
            <div className="min-w-0">
              <p className="text-sm font-medium text-destructive">Wipe local brain</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Permanently deletes all timeline events, mined patterns, links, and activity logs.
                Tool and person pages are preserved.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-red-300 text-destructive hover:bg-red-50 hover:text-destructive dark:border-red-800 dark:hover:bg-red-950"
              onClick={handleWipeBrain}
              disabled={wiping}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {wiping ? "Wiping..." : "Wipe brain"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
