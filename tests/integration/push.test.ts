import { beforeEach, describe, expect, it, vi } from "vitest";

// Push keys must exist before env() is first read (the DB setup reads it).
vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
});

// Never reach real push services from tests: capture sends instead.
const sent: { endpoint: string; payload: string }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  }
  return {
    WebPushError,
    default: {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
        if (failWith) throw new WebPushError("gone", failWith);
        sent.push({ endpoint: sub.endpoint, payload });
      }),
    },
  };
});

import { GET as adminPushStats, POST as adminPushSend } from "@/app/api/admin/push/route";
import { GET as pushKeyRoute, POST as pushRoute } from "@/app/api/push/route";
import { isAllowedPushEndpoint } from "@/lib/validation/push";
import { AuditLog } from "@/models/AuditLog";
import { PushSubscription } from "@/models/PushSubscription";
import { call, createUser, sessionCookieFor } from "../helpers/fixtures";

const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: `key-${n}`, auth: `auth-${n}` } });

beforeEach(() => {
  sent.length = 0;
  failWith = null;
});

describe("Push notifications", () => {
  it("only accepts real browser push services as endpoints (no SSRF)", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
  });

  it("lets a participant subscribe, check and unsubscribe a device", async () => {
    const user = await createUser();
    const cookie = await sessionCookieFor(user._id);
    expect((await call(pushKeyRoute, { cookie })).json.data.publicKey).toBe("test-public-key");
    expect((await call(pushRoute, { cookie, body: { action: "subscribe", subscription: sub(1) } })).json.data).toEqual({ subscribed: true });
    expect((await call(pushRoute, { cookie, body: { action: "check", endpoint: sub(1).endpoint } })).json.data).toEqual({ subscribed: true });
    expect((await call(pushRoute, { cookie, body: { action: "subscribe", subscription: { ...sub(2), endpoint: "https://attacker.example/x" } } })).status).toBe(400);
    await call(pushRoute, { cookie, body: { action: "unsubscribe", endpoint: sub(1).endpoint } });
    expect(await PushSubscription.countDocuments({ userId: user._id })).toBe(0);
  });

  it("admin broadcast reaches every subscribed active user, is audited, and drops expired devices", async () => {
    const a = await createUser();
    const b = await createUser();
    const disabled = await createUser({ active: false });
    await call(pushRoute, { cookie: await sessionCookieFor(a._id), body: { action: "subscribe", subscription: sub(10) } });
    await call(pushRoute, { cookie: await sessionCookieFor(b._id), body: { action: "subscribe", subscription: sub(11) } });
    await PushSubscription.create({ userId: disabled._id, ...sub(12) });
    const admin = await createUser({ role: "ADMIN" });
    const adminCookie = await sessionCookieFor(admin._id, "ADMIN");

    expect((await call(adminPushStats, { cookie: adminCookie })).json.data).toMatchObject({ configured: true, users: 3, devices: 3 });
    const res = await call(adminPushSend, { cookie: adminCookie, body: { title: "Day 5 is live", body: "Answer now", url: "/quiz" } });
    expect(res.json.data).toMatchObject({ devices: 2, users: 2, sent: 2, failed: 0 });
    expect(sent.map((s) => s.endpoint).sort()).toEqual([sub(10).endpoint, sub(11).endpoint]);
    expect(JSON.parse(sent[0]!.payload)).toEqual({ title: "Day 5 is live", body: "Answer now", url: "/quiz" });
    expect(await AuditLog.exists({ action: "PUSH_SENT" })).toBeTruthy();

    failWith = 410; // push service says the subscription is gone
    const again = await call(adminPushSend, { cookie: adminCookie, body: { title: "x", body: "y" } });
    expect(again.json.data).toMatchObject({ sent: 0, removed: 2 });
    expect(await PushSubscription.countDocuments({ userId: { $in: [a._id, b._id] } })).toBe(0);
  });

  it("rejects off-site links and non-admins", async () => {
    const user = await createUser();
    const cookie = await sessionCookieFor(user._id);
    expect((await call(adminPushSend, { cookie, body: { title: "x", body: "y" } })).status).toBeGreaterThanOrEqual(401);
    const admin = await createUser({ role: "ADMIN" });
    const adminCookie = await sessionCookieFor(admin._id, "ADMIN");
    expect((await call(adminPushSend, { cookie: adminCookie, body: { title: "x", body: "y", url: "https://evil.example" } })).status).toBe(400);
    expect((await call(adminPushSend, { cookie: adminCookie, body: { title: "x", body: "y", url: "//evil.example" } })).status).toBe(400);
  });
});
