"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

async function registerAndSubscribe(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array(65), // placeholder VAPID key
  });

  await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

  return subscription;
}

async function unsubscribe(subscription: PushSubscription): Promise<void> {
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  await fetch("/api/notifications/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

export function NotificationPermission() {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PermissionState);

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) setSubscription(sub);
      });
    });
  }, []);

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      setLoading(true);
      try {
        if (enabled) {
          const result = await Notification.requestPermission();
          setPermission(result as PermissionState);
          if (result === "granted") {
            const sub = await registerAndSubscribe();
            setSubscription(sub);
          }
        } else if (subscription) {
          await unsubscribe(subscription);
          setSubscription(null);
        }
      } catch {
        // Permission request or subscription failed
      } finally {
        setLoading(false);
      }
    },
    [subscription]
  );

  if (permission === "unsupported") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellOff className="h-5 w-5" />
            Notifications
          </CardTitle>
          <CardDescription>
            Push notifications are not supported in this browser.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isEnabled = permission === "granted" && subscription !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Coach Notifications
        </CardTitle>
        <CardDescription>
          Get nudges when Coach Mode detects a workflow you could improve.
          Notifications work even when the tab is in the background.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="push-notifications">Enable push notifications</Label>
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              id="push-notifications"
              checked={isEnabled}
              onCheckedChange={handleToggle}
              disabled={permission === "denied"}
            />
          )}
        </div>
        {permission === "denied" && (
          <p className="text-sm text-destructive">
            Notifications are blocked. Please enable them in your browser
            settings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
