import type { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { randomToken, sha256 } from "@/lib/security/crypto";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { Session, type SessionKind } from "@/models/Session";
import { User, type IUser, type Role } from "@/models/User";
import { getSettings } from "@/services/settings.service";

/**
 * Opaque, DB-backed sessions.
 *  - Cookie holds a 256-bit random token; DB stores only SHA-256(token).
 *  - HTTP-only, SameSite=Lax, Secure + `__Host-` prefix in production.
 *  - Sliding idle expiry capped by an absolute lifetime.
 *  - Periodic rotation (new token) on API requests; old token gets a short grace period.
 *  - Instant invalidation: revoke one, all for a user (sessionsInvalidatedAt), or global.
 */

export const SESSION_COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-qz_session" : "qz_session";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;
const ROTATION_INTERVAL_MS = 24 * HOUR_MS;
const ROTATION_GRACE_MS = 60_000;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar: string | null;
  isEmailVerified: boolean;
}

export interface AuthContext {
  user: SessionUser;
  userId: Types.ObjectId;
  session: { id: Types.ObjectId; kind: SessionKind; createdAt: Date; absoluteExpiresAt: Date };
}

export interface CookieToSet {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax" | "strict";
    path: string;
    expires: Date;
  };
}

export function toSessionUser(user: Pick<IUser, "_id" | "name" | "email" | "role" | "avatar" | "isEmailVerified">): SessionUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar ?? null,
    isEmailVerified: user.isEmailVerified,
  };
}

export function sessionCookie(token: string, expires: Date): CookieToSet {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires,
    },
  };
}

export function clearedSessionCookie(): CookieToSet {
  return sessionCookie("", new Date(0));
}

async function lifetimes(kind: SessionKind) {
  const { security } = await getSettings();
  if (kind === "ADMIN") {
    const absolute = security.adminSessionHours * HOUR_MS;
    return { absoluteMs: absolute, idleMs: Math.min(absolute, 2 * HOUR_MS) };
  }
  return { absoluteMs: security.sessionMaxDays * DAY_MS, idleMs: security.sessionIdleDays * DAY_MS };
}

export async function createSession(params: {
  userId: Types.ObjectId;
  kind: SessionKind;
  meta?: Pick<RequestMeta, "ip" | "userAgent"> | null;
  /** Keep an existing absolute expiry (used by rotation). */
  absoluteExpiresAt?: Date;
}): Promise<{ token: string; cookie: CookieToSet; sessionId: Types.ObjectId }> {
  await connectDb();
  const token = randomToken(32);
  const t = now();
  const { absoluteMs, idleMs } = await lifetimes(params.kind);
  const absoluteExpiresAt = params.absoluteExpiresAt ?? new Date(t.getTime() + absoluteMs);
  const expiresAt = new Date(Math.min(t.getTime() + idleMs, absoluteExpiresAt.getTime()));
  const [doc] = await Session.create([
    {
      tokenHash: sha256(token),
      userId: params.userId,
      kind: params.kind,
      createdAt: t,
      lastSeenAt: t,
      expiresAt,
      absoluteExpiresAt,
      ip: params.meta?.ip ?? null,
      userAgent: params.meta?.userAgent ?? null,
    },
  ]);
  return { token, cookie: sessionCookie(token, absoluteExpiresAt), sessionId: doc._id };
}

/**
 * Validates a raw cookie token. Returns null for anything invalid; never throws
 * for bad input. Slides the idle expiry at most every few minutes.
 */
export async function validateSessionToken(token: string | undefined | null): Promise<AuthContext | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  await connectDb();
  const t = now();
  const session = await Session.findOne({ tokenHash: sha256(token) }).lean();
  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() <= t.getTime() || session.absoluteExpiresAt.getTime() <= t.getTime()) return null;

  const user = await User.findById(session.userId)
    .select("name email role avatar isEmailVerified isActive sessionsInvalidatedAt")
    .lean();
  if (!user || !user.isActive) return null;
  if (user.sessionsInvalidatedAt && session.createdAt.getTime() < user.sessionsInvalidatedAt.getTime()) return null;
  // An ADMIN session for a user who is no longer an admin is dead.
  if (session.kind === "ADMIN" && user.role === "USER") return null;

  const settings = await getSettings();
  if (
    settings.globalSessionsInvalidatedAt &&
    session.createdAt.getTime() < settings.globalSessionsInvalidatedAt.getTime()
  ) {
    return null;
  }

  if (!session.rotatedAt && t.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const { idleMs } = await lifetimes(session.kind);
    const expiresAt = new Date(Math.min(t.getTime() + idleMs, session.absoluteExpiresAt.getTime()));
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: t, expiresAt } });
  }

  return {
    user: toSessionUser(user),
    userId: user._id,
    session: {
      id: session._id,
      kind: session.kind,
      createdAt: session.createdAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    },
  };
}

/** Rotates long-lived sessions. Returns the cookie to set, or null if no rotation was needed. */
export async function rotateSessionIfDue(
  auth: AuthContext,
  meta?: Pick<RequestMeta, "ip" | "userAgent">,
): Promise<CookieToSet | null> {
  const t = now();
  if (t.getTime() - auth.session.createdAt.getTime() < ROTATION_INTERVAL_MS) return null;
  // Claim the rotation atomically so concurrent requests don't mint several new sessions.
  const claimed = await Session.findOneAndUpdate(
    { _id: auth.session.id, rotatedAt: null, revokedAt: null },
    { $set: { rotatedAt: t, expiresAt: new Date(t.getTime() + ROTATION_GRACE_MS) } },
  ).lean();
  if (!claimed) return null;
  const created = await createSession({
    userId: auth.userId,
    kind: auth.session.kind,
    meta,
    absoluteExpiresAt: auth.session.absoluteExpiresAt,
  });
  return created.cookie;
}

export async function revokeSessionByToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await connectDb();
  await Session.updateOne({ tokenHash: sha256(token) }, { $set: { revokedAt: now(), expiresAt: now() } });
}

/** Force-logout: invalidates every session for the user created before now. */
export async function revokeAllUserSessions(userId: Types.ObjectId): Promise<void> {
  await connectDb();
  const t = now();
  await User.updateOne({ _id: userId }, { $set: { sessionsInvalidatedAt: t } });
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: t, expiresAt: t } });
}

export async function countActiveSessions(userId: Types.ObjectId): Promise<number> {
  await connectDb();
  return Session.countDocuments({ userId, revokedAt: null, expiresAt: { $gt: now() } });
}
