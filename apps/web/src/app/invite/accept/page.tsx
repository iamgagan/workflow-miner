"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { BrainCircuit } from "lucide-react";

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading…</div>}>
      <AcceptInviteInner />
    </Suspense>
  );
}

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<"idle" | "accepting" | "ok" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("Missing invite token in URL.");
    }
  }, [token]);

  async function accept() {
    if (!token) return;
    setStatus("accepting");
    setErrorMessage(null);

    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      router.push(`/login?next=${encodeURIComponent(`/invite/accept?token=${token}`)}`);
      return;
    }

    const response = await fetch("/api/orgs/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const payload = (await response.json()) as { organizationId?: string; error?: string };

    if (!response.ok) {
      setStatus("error");
      setErrorMessage(payload.error ?? "Failed to accept invite.");
      return;
    }

    // Refresh the session so the new app_metadata.organization_id is in the JWT.
    const refreshClient = createClient();
    await refreshClient.auth.refreshSession();
    setStatus("ok");
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <BrainCircuit className="mx-auto h-10 w-10 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Join organization</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You&apos;ve been invited to a Company Brain workspace.
          </p>
        </div>

        {status === "ok" ? (
          <p className="text-sm text-green-600">Joined — redirecting to your dashboard…</p>
        ) : (
          <Button className="w-full" onClick={accept} disabled={status === "accepting" || !token}>
            {status === "accepting" ? "Joining…" : "Accept invite"}
          </Button>
        )}

        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      </div>
    </div>
  );
}
