"use client";

import { BellRing, Share, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

/** "Later" / close hides the popup on this device for this long. */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "push-prompt-snooze-until";

type Mode = "ASK" | "BLOCKED" | "INSTALL_IOS";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* private mode: it will simply ask again next visit */
  }
}

async function subscribe(publicKey: string) {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api("/api/push", { body: { action: "subscribe", subscription: { endpoint: json.endpoint, keys: json.keys } } });
}

/**
 * Asks signed-in participants to turn on push notifications. Shown once per visit at most,
 * re-shown 3 days after "Later"; never shown again once notifications are on.
 * Users who already allowed them are silently (re)subscribed on this device.
 */
export function PushPrompt() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        // iPhone/iPad only support web push for sites added to the Home Screen.
        if (ios && !standalone && !snoozed()) setMode("INSTALL_IOS");
        return;
      }
      let key: string | null = null;
      try {
        key = (await api<{ publicKey: string | null }>("/api/push", { method: "GET" })).publicKey;
      } catch {
        return;
      }
      if (cancelled || !key) return; // push not configured on the server
      setPublicKey(key);
      if (Notification.permission === "granted") {
        await subscribe(key).catch(() => undefined); // keep this device's subscription current
        return;
      }
      if (snoozed()) return;
      setMode(Notification.permission === "denied" ? "BLOCKED" : "ASK");
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  function later() {
    snooze();
    setMode(null);
  }

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        await subscribe(publicKey);
        toast.success("Notifications are on. We'll remind you about each day's question.");
        setMode(null);
      } else if (permission === "denied") {
        setMode("BLOCKED");
      } else {
        later();
      }
    } catch {
      toast.error("Couldn't turn on notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!mode) return null;

  const content: Record<Mode, { title: string; body: React.ReactNode; action?: React.ReactNode }> = {
    ASK: {
      title: "Turn on notifications",
      body: "Get a reminder when each day's question opens and before it closes, so you never miss a day.",
      action: (
        <Button onClick={enable} loading={busy} loadingText="Turning on…">
          <BellRing /> Turn on notifications
        </Button>
      ),
    },
    BLOCKED: {
      title: "Notifications are blocked",
      body: (
        <>
          You blocked notifications for this site, so we can&apos;t remind you about new questions. To turn them on, tap the lock or settings icon next
          to the web address, choose <strong>Notifications → Allow</strong>, then reload the page.
        </>
      ),
    },
    INSTALL_IOS: {
      title: "Get reminders on your iPhone",
      body: (
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Tap the <Share className="inline size-4 align-text-bottom" aria-label="Share" /> Share button in Safari.
          </li>
          <li>
            Choose <SquarePlus className="inline size-4 align-text-bottom" aria-hidden /> <strong>Add to Home Screen</strong>.
          </li>
          <li>Open the quiz from your Home Screen and turn on notifications.</li>
        </ol>
      ),
    },
  };
  const c = content[mode];

  return (
    <Dialog
      open
      onClose={later}
      title={c.title}
      footer={
        <>
          <Button variant="outline" onClick={later}>
            Later
          </Button>
          {c.action}
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted-foreground">{c.body}</div>
    </Dialog>
  );
}
