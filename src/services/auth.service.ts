import type { Types } from "mongoose";
import { createSession, revokeAllUserSessions, toSessionUser, type CookieToSet, type SessionUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/rbac";
import { connectDb } from "@/lib/db/mongoose";
import { env } from "@/lib/env";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/notifications/email";
import { randomToken, safeEqual, sha256 } from "@/lib/security/crypto";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/security/password";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { AuthToken, type AuthTokenType } from "@/models/AuthToken";
import { User } from "@/models/User";
import { recordAudit } from "@/services/audit.service";
import { getSettings } from "@/services/settings.service";

const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 3_600_000;
const HOUR_MS = 3_600_000;

type Meta = Pick<RequestMeta, "ip" | "userAgent">;

async function issueToken(userId: Types.ObjectId, type: AuthTokenType, ttlMs: number): Promise<string> {
  // Only the newest link of each type is valid.
  await AuthToken.deleteMany({ userId, type, usedAt: null });
  const token = randomToken(32);
  await AuthToken.create({ userId, type, tokenHash: sha256(token), expiresAt: new Date(now().getTime() + ttlMs) });
  return token;
}

/** Atomically consumes a one-time token; returns its userId or throws INVALID_TOKEN. */
async function consumeToken(token: string, type: AuthTokenType): Promise<Types.ObjectId> {
  const t = now();
  const doc = await AuthToken.findOneAndUpdate(
    { tokenHash: sha256(token), type, usedAt: null, expiresAt: { $gt: t } },
    { $set: { usedAt: t } },
  ).lean();
  if (!doc) throw new AppError("INVALID_TOKEN");
  return doc.userId;
}

export async function signup(
  input: { name: string; email: string; password: string },
  meta: Meta,
): Promise<{ user: SessionUser; cookie: CookieToSet }> {
  await connectDb();
  const settings = await getSettings();
  if (!settings.platform.registrationEnabled) throw new AppError("REGISTRATION_DISABLED");
  await enforceRateLimit({ key: `signup:ip:${meta.ip ?? "unknown"}`, limit: settings.security.signupRateLimitPerIp, windowMs: HOUR_MS });

  const passwordHash = await hashPassword(input.password);
  let user;
  try {
    // Role is never taken from input; every self-registered account is USER.
    [user] = await User.create([{ name: input.name, email: input.email, passwordHash, role: "USER" }]);
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError("EMAIL_IN_USE");
    throw e;
  }

  const token = await issueToken(user._id, "VERIFY_EMAIL", VERIFY_TTL_MS);
  await sendVerificationEmail(user.email, user.name, token);
  const { cookie } = await createSession({ userId: user._id, kind: "USER", meta });
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: now(), lastLoginIp: meta.ip } });
  return { user: toSessionUser(user), cookie };
}

/**
 * Password login with:
 *  - per-IP rate limit
 *  - per-account lockout after N consecutive failures (settings.security)
 *  - timing equalisation for unknown emails
 *  - USER_DISABLED only revealed after a correct password
 */
export async function login(
  input: { email: string; password: string },
  meta: Meta,
  kind: "USER" | "ADMIN" = "USER",
): Promise<{ user: SessionUser; cookie: CookieToSet }> {
  await connectDb();
  const { security } = await getSettings();
  await enforceRateLimit({ key: `login:ip:${meta.ip ?? "unknown"}`, limit: security.loginRateLimitPerIp, windowMs: 15 * 60_000 });

  const user = await User.findOne({ email: input.email }).select("+passwordHash +failedLoginAttempts +lockUntil");
  if (!user) {
    await verifyAgainstDummy(input.password);
    throw new AppError("INVALID_CREDENTIALS");
  }

  const t = now();
  if (user.lockUntil && user.lockUntil.getTime() > t.getTime()) {
    throw new AppError("ACCOUNT_LOCKED", undefined, { retryAfterSeconds: Math.ceil((user.lockUntil.getTime() - t.getTime()) / 1000) });
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const lock = attempts >= security.loginAttemptLimit;
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLoginAttempts: lock ? 0 : attempts,
          lockUntil: lock ? new Date(t.getTime() + security.lockoutMinutes * 60_000) : null,
        },
      },
    );
    if (lock) logger.warn("auth.account_locked", { userId: String(user._id), ip: meta.ip });
    throw new AppError(lock ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS");
  }

  if (!user.isActive) throw new AppError("USER_DISABLED");
  if (kind === "ADMIN" && !isAdminRole(user.role)) {
    // Don't confirm to non-admins that their password was right on the admin form.
    throw new AppError("INVALID_CREDENTIALS");
  }

  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginAttempts: 0, lockUntil: null, lastLoginAt: t, lastLoginIp: meta.ip } },
  );
  const { cookie } = await createSession({ userId: user._id, kind, meta });
  if (kind === "ADMIN") {
    await recordAudit({ adminId: user._id, action: "ADMIN_LOGIN", targetType: "User", targetId: user._id, meta });
  }
  return { user: toSessionUser(user), cookie };
}

export async function resendVerification(userId: Types.ObjectId): Promise<void> {
  await connectDb();
  const user = await User.findById(userId).lean();
  if (!user || user.isEmailVerified) return;
  await enforceRateLimit({ key: `verify-resend:u:${String(userId)}`, limit: 3, windowMs: HOUR_MS });
  const token = await issueToken(user._id, "VERIFY_EMAIL", VERIFY_TTL_MS);
  await sendVerificationEmail(user.email, user.name, token);
}

export async function verifyEmail(token: string): Promise<void> {
  await connectDb();
  const userId = await consumeToken(token, "VERIFY_EMAIL");
  await User.updateOne({ _id: userId }, { $set: { isEmailVerified: true, emailVerifiedAt: now() } });
}

/** Always resolves the same way regardless of whether the email exists (no enumeration). */
export async function requestPasswordReset(email: string, meta: Meta): Promise<void> {
  await connectDb();
  await enforceRateLimit({ key: `forgot:ip:${meta.ip ?? "unknown"}`, limit: 10, windowMs: HOUR_MS });
  await enforceRateLimit({ key: `forgot:email:${sha256(email)}`, limit: 3, windowMs: HOUR_MS });
  const user = await User.findOne({ email }).lean();
  if (!user || !user.isActive) return;
  const token = await issueToken(user._id, "RESET_PASSWORD", RESET_TTL_MS);
  await sendPasswordResetEmail(user.email, user.name, token);
}

/** Admin-triggered reset: sends the user a reset link. Admins never see or set passwords. */
export async function sendAdminInitiatedReset(userId: Types.ObjectId): Promise<void> {
  const user = await User.findById(userId).lean();
  if (!user) throw new AppError("NOT_FOUND");
  const token = await issueToken(user._id, "RESET_PASSWORD", RESET_TTL_MS);
  await sendPasswordResetEmail(user.email, user.name, token);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await connectDb();
  const userId = await consumeToken(token, "RESET_PASSWORD");
  const passwordHash = await hashPassword(password);
  // Owning the inbox proves the email; clear lockout; kill every existing session.
  await User.updateOne(
    { _id: userId },
    { $set: { passwordHash, isEmailVerified: true, failedLoginAttempts: 0, lockUntil: null } },
  );
  await User.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: now() } });
  await revokeAllUserSessions(userId);
}

export async function changePassword(
  userId: Types.ObjectId,
  currentPassword: string,
  newPassword: string,
  meta: Meta,
): Promise<CookieToSet> {
  await connectDb();
  await enforceRateLimit({ key: `change-pw:u:${String(userId)}`, limit: 5, windowMs: HOUR_MS });
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new AppError("UNAUTHORIZED");
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError("INVALID_CREDENTIALS", "Your current password is incorrect.");
  }
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  // Rotate: invalidate all sessions (other devices) and issue a fresh one for this device.
  await revokeAllUserSessions(userId);
  const { cookie } = await createSession({ userId, kind: "USER", meta });
  return cookie;
}

/**
 * One-time bootstrap of the first SUPER_ADMIN, protected by ADMIN_SETUP_SECRET.
 * Refuses once any SUPER_ADMIN exists.
 */
export async function setupFirstAdmin(
  input: { setupSecret: string; name: string; email: string; password: string },
  meta: Meta,
): Promise<void> {
  await connectDb();
  await enforceRateLimit({ key: `admin-setup:ip:${meta.ip ?? "unknown"}`, limit: 5, windowMs: HOUR_MS });
  const expected = env().ADMIN_SETUP_SECRET;
  if (!expected || expected.length < 16 || !safeEqual(input.setupSecret, expected)) throw new AppError("FORBIDDEN");
  if (await User.exists({ role: "SUPER_ADMIN" })) throw new AppError("SETUP_ALREADY_COMPLETED");
  const passwordHash = await hashPassword(input.password);
  const user = await User.findOneAndUpdate(
    { email: input.email },
    {
      $set: { role: "SUPER_ADMIN", isEmailVerified: true, emailVerifiedAt: now(), isActive: true, passwordHash },
      $setOnInsert: { name: input.name, email: input.email },
    },
    { upsert: true, returnDocument: "after" },
  );
  await recordAudit({ adminId: user?._id ?? null, action: "ADMIN_SETUP", targetType: "User", targetId: user?._id, meta });
}
