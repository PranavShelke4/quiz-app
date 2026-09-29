import type { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { isDuplicateKeyError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import type { ICompetition } from "@/models/Competition";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Session } from "@/models/Session";
import { SuspicionFlag, type FlagStatus, type FlagType } from "@/models/SuspicionFlag";
import { User } from "@/models/User";
import { recordAudit } from "@/services/audit.service";

/**
 * Heuristics only. Flags are raised for admin review and never change scores
 * or accounts automatically.
 */
export const ANTICHEAT_THRESHOLDS = {
  /** Distinct accounts answering the same day from one IP. */
  multipleAccountsPerIp: 3,
  /** Accounts on one IP submitting within this window of each other. */
  rapidWindowMs: 2 * 60_000,
  rapidMinAccounts: 3,
  /** Distinct IPs for one user's sessions within 24h. */
  distinctSessionIps: 4,
} as const;

async function raise(params: { competitionId: Types.ObjectId; userId: Types.ObjectId; type: FlagType; dayNumber: number | null; details: Record<string, unknown> }) {
  try {
    await SuspicionFlag.create(params);
    return 1;
  } catch (e) {
    if (isDuplicateKeyError(e)) return 0;
    throw e;
  }
}

export async function detectSuspiciousActivity(comp: ICompetition, dayNumber: number, at: Date = now()) {
  await connectDb();
  let raised = 0;
  const answers = await DailyAnswer.find({ competitionId: comp._id, dayNumber, status: "ANSWERED", ip: { $ne: null } })
    .select("userId ip answeredAt")
    .lean();

  const byIp = new Map<string, typeof answers>();
  for (const a of answers) {
    const list = byIp.get(a.ip!) ?? [];
    list.push(a);
    byIp.set(a.ip!, list);
  }

  for (const [ip, list] of byIp) {
    const users = [...new Set(list.map((a) => String(a.userId)))];
    if (users.length >= ANTICHEAT_THRESHOLDS.multipleAccountsPerIp) {
      for (const a of list) {
        raised += await raise({ competitionId: comp._id, userId: a.userId, type: "MULTIPLE_ACCOUNTS", dayNumber, details: { ip, accounts: users.length } });
      }
    }
    const sorted = [...list].sort((a, b) => a.answeredAt!.getTime() - b.answeredAt!.getTime());
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = sorted[i]!.answeredAt!.getTime() + ANTICHEAT_THRESHOLDS.rapidWindowMs;
      const cluster = sorted.filter((s, j) => j >= i && s.answeredAt!.getTime() <= windowEnd);
      if (cluster.length >= ANTICHEAT_THRESHOLDS.rapidMinAccounts) {
        for (const c of cluster) {
          raised += await raise({ competitionId: comp._id, userId: c.userId, type: "RAPID_SUBMISSIONS", dayNumber, details: { ip, clusterSize: cluster.length, windowSeconds: ANTICHEAT_THRESHOLDS.rapidWindowMs / 1000 } });
        }
        break;
      }
    }
  }

  // Many distinct IPs for a single participant's sessions in the last 24h.
  const since = new Date(at.getTime() - 86_400_000);
  const sessionIps = await Session.aggregate<{ _id: Types.ObjectId; ips: string[] }>([
    { $match: { createdAt: { $gte: since }, ip: { $ne: null }, userId: { $in: answers.map((a) => a.userId) } } },
    { $group: { _id: "$userId", ips: { $addToSet: "$ip" } } },
    { $match: { [`ips.${ANTICHEAT_THRESHOLDS.distinctSessionIps - 1}`]: { $exists: true } } },
  ]);
  for (const s of sessionIps) {
    raised += await raise({ competitionId: comp._id, userId: s._id, type: "SUSPICIOUS_ACTIVITY", dayNumber, details: { distinctIps24h: s.ips.length } });
  }
  return raised;
}

export async function listFlags(params: { status?: FlagStatus; competitionId?: string; page: number; pageSize: number }) {
  await connectDb();
  const filter: Record<string, unknown> = {};
  if (params.status) filter.status = params.status;
  if (params.competitionId) filter.competitionId = params.competitionId;
  const [items, total] = await Promise.all([
    SuspicionFlag.find(filter).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean(),
    SuspicionFlag.countDocuments(filter),
  ]);
  const users = await User.find({ _id: { $in: items.map((i) => i.userId) } }).select("name email").lean();
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  return {
    total,
    items: items.map((f) => ({
      id: String(f._id),
      userId: String(f.userId),
      userName: uMap.get(String(f.userId))?.name ?? "Deleted user",
      userEmail: uMap.get(String(f.userId))?.email ?? "",
      type: f.type,
      dayNumber: f.dayNumber,
      details: f.details,
      status: f.status,
      reviewNote: f.reviewNote,
      createdAt: f.createdAt.toISOString(),
    })),
  };
}

export async function reviewFlag(id: string, status: "DISMISSED" | "CONFIRMED", note: string, actor: { userId: Types.ObjectId; meta: Pick<RequestMeta, "ip" | "userAgent"> }) {
  await connectDb();
  await SuspicionFlag.updateOne({ _id: id }, { $set: { status, reviewNote: note, reviewedBy: actor.userId, reviewedAt: now() } });
  await recordAudit({ adminId: actor.userId, action: "FLAG_REVIEWED", targetType: "SuspicionFlag", targetId: id, metadata: { status, note }, meta: actor.meta });
}
