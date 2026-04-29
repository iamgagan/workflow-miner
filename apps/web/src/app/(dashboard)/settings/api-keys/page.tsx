"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trash2, Key, Copy, Check } from "lucide-react";

interface ApiKey {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadKeys() {
    setLoading(true);
    const res = await fetch("/api/keys");
    const data = await res.json();
    setKeys(data.keys ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  async function createKey() {
    if (!newLabel.trim()) return;
    setCreating(true);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setRevealedKey(data.key);
      setNewLabel("");
      await loadKeys();
    }
    setCreating(false);
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this key? Any client using it will lose access immediately.")) return;
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (res.ok) await loadKeys();
  }

  async function copyKey() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate keys to use the Company Brain from Claude Code, Cursor, or any MCP client. See{" "}
          <a className="underline" href="https://www.npmjs.com/package/@workflow-miner/mcp" target="_blank" rel="noopener noreferrer">
            @workflow-miner/mcp
          </a>{" "}
          for setup instructions.
        </p>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Create new key</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Label (e.g. 'gagan-laptop-claude-code')"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            disabled={creating}
          />
          <Button onClick={createKey} disabled={creating || !newLabel.trim()}>
            <Key className="w-4 h-4 mr-2" />
            Create
          </Button>
        </div>
      </Card>

      {revealedKey ? (
        <Card className="p-4 border-amber-500/50 bg-amber-500/5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Your new key — copy it now</h3>
            <Button variant="ghost" size="sm" onClick={() => setRevealedKey(null)}>
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            We hash and never store the raw key. This is the only time you&apos;ll see it.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 bg-muted px-3 py-2 rounded text-xs font-mono break-all">
              {revealedKey}
            </code>
            <Button variant="outline" size="sm" onClick={copyKey}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Active keys</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet. Create one above.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between p-2 rounded border">
                <div>
                  <div className="font-mono text-sm">{key.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Created {new Date(key.created_at).toLocaleDateString()} ·{" "}
                    {key.last_used_at
                      ? `Last used ${new Date(key.last_used_at).toLocaleString()}`
                      : "Never used"}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revokeKey(key.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
