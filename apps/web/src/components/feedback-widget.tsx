"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X, Loader2, Check } from "lucide-react";

type Status = "idle" | "sending" | "sent" | "error";

export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const submit = async () => {
    if (message.trim().length < 3) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim(), context: pathname }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("sent");
      setMessage("");
      setTimeout(() => {
        setOpen(false);
        setStatus("idle");
      }, 1500);
    } catch {
      setStatus("error");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm font-medium text-muted-foreground shadow-warm-card transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Send feedback"
      >
        <MessageCircle className="h-4 w-4" />
        Feedback
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 w-80 rounded-xl border bg-card p-4 shadow-warm-card">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Send feedback</h3>
        <button
          onClick={() => {
            setOpen(false);
            setStatus("idle");
          }}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Bug, confusion, or idea — anything helps.
      </p>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What did you notice?"
        disabled={status === "sending" || status === "sent"}
        className="mt-3 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        rows={4}
      />

      {status === "error" && (
        <p className="mt-2 text-xs text-destructive">
          Failed to send. Check your connection and try again.
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={message.trim().length < 3 || status === "sending" || status === "sent"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {status === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {status === "sent" && <Check className="h-3.5 w-3.5" />}
          {status === "sending" ? "Sending..." : status === "sent" ? "Sent" : "Send"}
        </button>
      </div>
    </div>
  );
}
