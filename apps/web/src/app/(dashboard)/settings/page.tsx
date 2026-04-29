"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, Settings, Unplug, Trash2, Sparkles, Github, Key } from "lucide-react";
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

export default function SettingsPage() {
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [disconnecting, setDisconnecting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [dreamStatus, setDreamStatus] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  async function runDreamCycle() {
    setDreamStatus("Dispatching…");
    const res = await fetch("/api/dream/run", { method: "POST" });
    const data = await res.json();
    setDreamStatus(res.ok ? `Dispatched (event ${data.eventId})` : `Error: ${data.error}`);
  }

  async function runExport() {
    setExportStatus("Dispatching…");
    const res = await fetch("/api/export/run", { method: "POST" });
    const data = await res.json();
    setExportStatus(res.ok ? `Dispatched (event ${data.eventId})` : `Error: ${data.error}`);
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

      <Card className="shadow-warm-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Dream Cycle
          </CardTitle>
          <CardDescription>
            Manually trigger the LLM enrichment pass (entity extraction + compiled-truth refresh).
            Normally runs automatically on a cron.
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
            <Github className="h-5 w-5 text-primary" />
            Markdown export
          </CardTitle>
          <CardDescription>
            Manually push a markdown mirror of the brain to your configured GitHub repo. Requires{" "}
            <code className="text-xs">GITHUB_EXPORT_PAT</code> and{" "}
            <code className="text-xs">GITHUB_EXPORT_REPO</code> env vars.
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
