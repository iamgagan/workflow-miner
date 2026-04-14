import { NextResponse } from "next/server";

interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  subscribedAt: string;
}

// Stub: in-memory storage until push notifications are fully wired up
// (requires real VAPID keys and persistent storage).
const MAX_SUBSCRIPTIONS = 1000;
const subscriptions: PushSubscriptionRecord[] = [];

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return NextResponse.json(
        { error: "Invalid push subscription: missing endpoint or keys" },
        { status: 400 }
      );
    }

    const existing = subscriptions.findIndex(
      (s) => s.endpoint === body.endpoint
    );
    const record: PushSubscriptionRecord = {
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      subscribedAt: new Date().toISOString(),
    };

    if (existing >= 0) {
      subscriptions[existing] = record;
    } else if (subscriptions.length >= MAX_SUBSCRIPTIONS) {
      return NextResponse.json(
        { error: "Subscription limit reached" },
        { status: 503 },
      );
    } else {
      subscriptions.push(record);
    }

    return NextResponse.json({
      success: true,
      message: "Push subscription stored",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to process subscription" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();

    if (!body.endpoint) {
      return NextResponse.json(
        { error: "Missing endpoint" },
        { status: 400 }
      );
    }

    const index = subscriptions.findIndex(
      (s) => s.endpoint === body.endpoint
    );
    if (index >= 0) {
      subscriptions.splice(index, 1);
    }

    return NextResponse.json({
      success: true,
      message: "Push subscription removed",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to process unsubscription" },
      { status: 500 }
    );
  }
}
