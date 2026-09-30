import { Types } from "mongoose";
import { countActiveSessions, revokeAllUserSessions } from "@/lib/auth/session";
import { connectDb } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { escapeRegex } from "@/lib/validation/common";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { Competition } from "@/models/Competition";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Session } from "@/models/Session";
import { SuspicionFlag } from "@/models/SuspicionFlag";
import { User, type IUser, type Role } from "@/models/User";
import { recordAudit } from "@/services/audit.service";
import { createPasswordResetLink } from "@/services/auth.service";
import { isLeaderboardRevealed } from "@/services/competition.service";

type Actor = { userId: Types.ObjectId; role: Role; meta: Pick<RequestMeta, "ip" | "userAgent"> };

export type UserSort = "createdAt" | "lastLoginAt" | "name" | "email";

/** Admin list DTO — never includes password hashes or security counters. */
export function toAdminUser(u: IUser) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    team: u.team ?? "General",
    avatar: u.avatar,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    disabledReason: u.disabledReason,
  };
}
export type AdminUserDTO = ReturnType<typeof toAdminUser>;

export function buildUserFilter(params: { search?: string; status?: string; role?: string; team?: string; from?: string; to?: string }) {
  const filter: Record<string, unknown> = {};
  if (params.search) {
    const re = { $regex: escapeRegex(params.search), $options: "i" };
    filter.$or = [{ name: re }, { email: re }];
  }
  if (params.status === "active") filter.isActive = true;
  if (params.status === "disabled") filter.isActive = false;
  if (params.role && ["USER", "ADMIN", "SUPER_ADMIN"].includes(params.role)) filter.role = params.role;
  if (params.team && params.team !== "All") filter.team = params.team;
  const created: Record<string, Date> = {};
  if (params.from && !Number.isNaN(Date.parse(params.from))) created.$gte = new Date(params.from);
  if (params.to && !Number.isNaN(Date.parse(params.to))) created.$lte = new Date(`${params.to}T23:59:59.999Z`);
  if (Object.keys(created).length) filter.createdAt = created;
  return filter;
}

export async function listUsers(params: {
  search?: string;
  status?: string;
  role?: string;
  team?: string;
  from?: string;
  to?: string;
  sort?: UserSort;
  dir?: "asc" | "desc";
  page: number;
  pageSize: number;
}) {
  await connectDb();
  const filter = buildUserFilter(params);
  const sortKey = params.sort ?? "createdAt";
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ [sortKey]: params.dir === "asc" ? 1 : -1, _id: 1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .lean(),
    User.countDocuments(filter),
  ]);
  return { items: items.map(toAdminUser), total };
}

export async function getUserDetail(id: string) {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) throw new AppError("NOT_FOUND");
  const user = await User.findById(id).select("+lastLoginIp +failedLoginAttempts +lockUntil").lean();
  if (!user) throw new AppError("NOT_FOUND");

  const participations = await CompetitionParticipant.find({ userId: user._id }).sort({ joinedAt: -1 }).lean();
  const comps = await Competition.find({ _id: { $in: participations.map((p) => p.competitionId) } }).lean();
  const compMap = new Map(comps.map((c) => [String(c._id), c]));
  const [activeSessions, sessions, flags] = await Promise.all([
    countActiveSessions(user._id),
    Session.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10).select("kind createdAt lastSeenAt ip userAgent revokedAt expiresAt").lean(),
    SuspicionFlag.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);

  return {
    user: {
      ...toAdminUser(user),
      // Security metadata: admin-only, shown for abuse investigation.
      lastLoginIp: user.lastLoginIp ?? null,
      lockedUntil: user.lockUntil && user.lockUntil > now() ? user.lockUntil.toISOString() : null,
      failedLoginAttempts: user.failedLoginAttempts ?? 0,
    },
    activeSessions,
    sessions: sessions.map((s) => ({
      kind: s.kind,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      ip: s.ip,
      userAgent: s.userAgent,
      active: !s.revokedAt && s.expiresAt > now(),
    })),
    flags: flags.map((f) => ({ id: String(f._id), type: f.type, dayNumber: f.dayNumber, status: f.status, details: f.details, createdAt: f.createdAt.toISOString() })),
    competitions: participations.map((p) => {
      const c = compMap.get(String(p.competitionId));
      return {
        competitionId: String(p.competitionId),
        name: c?.name ?? "Unknown",
        status: c?.status ?? "ARCHIVED",
        durationDays: c?.durationDays ?? 0,
        joinedAt: p.joinedAt.toISOString(),
        answered: p.answeredDays,
        missed: p.missedDays,
        // Admins see everything; `revealed` lets the UI label pre-reveal data as confidential.
        score: p.totalScore,
        correct: p.correctAnswers,
        wrong: p.wrongAnswers,
        rank: p.finalRank,
        currentStreak: p.currentStreak,
        longestStreak: p.longestStreak,
        revealed: c ? isLeaderboardRevealed(c) : false,
      };
    }),
  };
}

export async function getUserAnswers(userId: string, competitionId: string) {
  await connectDb();
  return DailyAnswer.find({ userId, competitionId }).sort({ dayNumber: 1 }).lean();
}

async function loadTarget(id: string, actor: Actor) {
  if (!Types.ObjectId.isValid(id)) throw new AppError("NOT_FOUND");
  const user = await User.findById(id).lean();
  if (!user) throw new AppError("NOT_FOUND");
  // Only a SUPER_ADMIN may act on admin accounts; nobody may act on themselves here.
  if (user.role !== "USER" && actor.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN", "Only a super admin can manage admin accounts.");
  return user;
}

export async function setUserActive(id: string, active: boolean, reason: string | undefined, actor: Actor) {
  await connectDb();
  const user = await loadTarget(id, actor);
  if (String(user._id) === String(actor.userId)) throw new AppError("FORBIDDEN", "You can't disable your own account.");
  await User.updateOne(
    { _id: user._id },
    { $set: active ? { isActive: true, disabledAt: null, disabledReason: null } : { isActive: false, disabledAt: now(), disabledReason: reason ?? null } },
  );
  if (!active) await revokeAllUserSessions(user._id);
  await recordAudit({ adminId: actor.userId, action: active ? "USER_ENABLED" : "USER_DISABLED", targetType: "User", targetId: user._id, metadata: { reason: reason ?? null }, meta: actor.meta });
}

export async function forceLogout(id: string, actor: Actor) {
  await connectDb();
  const user = await loadTarget(id, actor);
  await revokeAllUserSessions(user._id);
  await recordAudit({ adminId: actor.userId, action: "USER_FORCE_LOGOUT", targetType: "User", targetId: user._id, meta: actor.meta });
}

export async function adminCreateResetLink(id: string, actor: Actor): Promise<string> {
  await connectDb();
  const user = await loadTarget(id, actor);
  const resetUrl = await createPasswordResetLink(user._id);
  await recordAudit({ adminId: actor.userId, action: "USER_PASSWORD_RESET_SENT", targetType: "User", targetId: user._id, meta: actor.meta });
  return resetUrl;
}

/** SUPER_ADMIN only (enforced by route permission `admins:manage`). */
export async function changeUserRole(id: string, role: Role, actor: Actor) {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) throw new AppError("NOT_FOUND");
  const user = await User.findById(id).lean();
  if (!user) throw new AppError("NOT_FOUND");
  if (String(user._id) === String(actor.userId)) throw new AppError("FORBIDDEN", "You can't change your own role.");
  if (user.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
    const supers = await User.countDocuments({ role: "SUPER_ADMIN", isActive: true });
    if (supers <= 1) throw new AppError("CONFLICT", "There must be at least one active super admin.");
  }
  await User.updateOne({ _id: user._id }, { $set: { role } });
  // Privilege change → rotate: existing sessions carry the old role context.
  await revokeAllUserSessions(user._id);
  await recordAudit({ adminId: actor.userId, action: "USER_ROLE_CHANGED", targetType: "User", targetId: user._id, metadata: { from: user.role, to: role }, meta: actor.meta });
}

// ---------------------------------------------------------------------------
// Self-service profile (always scoped to the session user).
// ---------------------------------------------------------------------------
export async function getOwnProfile(userId: Types.ObjectId) {
  await connectDb();
  const user = await User.findById(userId).lean();
  if (!user) throw new AppError("UNAUTHORIZED");
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    team: user.team ?? "General",
    avatar: user.avatar,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export async function updateOwnProfile(userId: Types.ObjectId, input: { name?: string; team?: string; avatar?: string }) {
  await connectDb();
  const $set: Record<string, unknown> = {};
  if (input.name !== undefined) $set.name = input.name;
  if (input.team !== undefined) $set.team = input.team;
  if (input.avatar !== undefined) $set.avatar = input.avatar || null;
  if (Object.keys($set).length) {
    await User.updateOne({ _id: userId }, { $set });
    if (input.team !== undefined) {
      await CompetitionParticipant.updateMany({ userId }, { $set: { team: input.team } });
    }
  }
  return getOwnProfile(userId);
}
