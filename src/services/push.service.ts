import "server-only";
import type { Types } from "mongoose";
import webpush, { WebPushError } from "web-push";
import { connectDb } from "@/lib/db/mongoose";
import { appUrl, env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { RequestMeta } from "@/lib/security/request-meta";
import { PushSubscription } from "@/models/PushSubscription";
import { User } from "@/models/User";
import { recordAudit } from "@/services/audit.service";
import { runWithConcurrency } from "@/services/participant.service";

/** Public key for the browser (null when push isn't configured, so the UI stays hidden). */
export function pushPublicKey(): string | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env();
  return VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY ? VAPID_PUBLIC_KEY : null;
}

let configured = false;
function ensureConfigured() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env();
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  if (!configured) {
    const site = appUrl("/");
    const subject = VAPID_SUBJECT || (site.startsWith("https://") ? site : "mailto:noreply@example.com");
    webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  }
  return true;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Stores (or moves to this user) a browser's push subscription. */
export async function saveSubscription(userId: Types.ObjectId, sub: BrowserSubscription, userAgent: string | null) {
  await connectDb();
  await PushSubscription.updateOne(
    { endpoint: sub.endpoint },
    { $set: { userId, keys: sub.keys, userAgent: userAgent?.slice(0, 400) ?? null } },
    { upsert: true },
  );
  return { subscribed: true };
}

export async function removeSubscription(userId: Types.ObjectId, endpoint: string) {
  await connectDb();
  await PushSubscription.deleteOne({ userId, endpoint });
  return { subscribed: false };
}

export async function hasSubscription(userId: Types.ObjectId, endpoint: string) {
  await connectDb();
  return { subscribed: !!(await PushSubscription.exists({ userId, endpoint })) };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped (same-site path). */
  url?: string;
}

/**
 * Sends to every stored subscription (optionally only some users). Subscriptions the push
 * service reports as gone (404/410: uninstalled, blocked, expired) are deleted.
 */
export async function sendPush(message: PushMessage, opts: { userIds?: Types.ObjectId[] } = {}) {
  await connectDb();
  if (!ensureConfigured()) throw new Error("Push notifications aren't configured (VAPID keys missing).");
  // Disabled accounts never receive pushes.
  const activeUsers = await User.find({ isActive: true, ...(opts.userIds ? { _id: { $in: opts.userIds } } : {}) }).select("_id").lean();
  const subs = await PushSubscription.find({ userId: { $in: activeUsers.map((u) => u._id) } }).lean();
  const payload = JSON.stringify({ title: message.title, body: message.body, url: message.url || "/quiz" });
  let sent = 0;
  let failed = 0;
  const gone: Types.ObjectId[] = [];
  const delivered: Types.ObjectId[] = [];
  await runWithConcurrency(subs, 20, async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 60 * 60 * 12, urgency: "high" });
      sent++;
      delivered.push(s._id);
    } catch (e) {
      failed++;
      if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) gone.push(s._id);
      else logger.warn("push.send_failed", { status: e instanceof WebPushError ? e.statusCode : null, error: (e as Error).message });
    }
  });
  if (gone.length) await PushSubscription.deleteMany({ _id: { $in: gone } });
  if (delivered.length) await PushSubscription.updateMany({ _id: { $in: delivered } }, { $set: { lastSuccessAt: new Date() } });
  return { devices: subs.length, users: new Set(subs.map((s) => String(s.userId))).size, sent, failed, removed: gone.length };
}

/** Admin broadcast to everyone who turned notifications on; audited. */
export async function broadcastPush(message: PushMessage, actor: { userId: Types.ObjectId; meta: Pick<RequestMeta, "ip" | "userAgent"> }) {
  const result = await sendPush(message);
  await recordAudit({ adminId: actor.userId, action: "PUSH_SENT", targetType: "PushSubscription", metadata: { ...message, ...result }, meta: actor.meta });
  return result;
}

export async function pushStats() {
  await connectDb();
  const [devices, users] = await Promise.all([PushSubscription.countDocuments(), PushSubscription.distinct("userId").then((ids) => ids.length)]);
  const totalUsers = await User.countDocuments({ isActive: true, role: "USER" });
  return { configured: !!pushPublicKey(), devices, users, totalUsers };
}
