import type { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { isDuplicateKeyError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request-meta";
import { minimumPlausibleAnswerMs } from "@/lib/quiz/anticheat-config";
import { selectedIdsOf } from "@/lib/quiz/scoring";
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
  /** Same-wrong-answers: a wrong choice only counts if at most this share of the day's answerers made it. */
  rareWrongShare: 0.25,
  /** …and the pair must share such a rare wrong choice on at least this many days. */
  sharedWrongDays: 3,
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

/**
 * Timed mode: a correct answer submitted faster than the question can be read.
 * Raised right after the answer is stored; never changes the score.
 */
export async function flagFastAnswer(params: {
  competitionId: Types.ObjectId;
  userId: Types.ObjectId;
  dayNumber: number;
  question: { questionText: string; options: { text: string }[] };
  responseMs: number;
  isCorrect: boolean;
}) {
  if (!params.isCorrect) return 0; // a fast wrong answer is a guess, not an advantage
  const minimumMs = minimumPlausibleAnswerMs(params.question);
  if (params.responseMs >= minimumMs) return 0;
  return raise({
    competitionId: params.competitionId,
    userId: params.userId,
    type: "FAST_ANSWER",
    dayNumber: params.dayNumber,
    details: { responseMs: params.responseMs, minimumMs },
  });
}

/** One-line, human-readable summary of a flag's evidence for the review list. */
export function describeFlagDetails(type: FlagType, d: Record<string, unknown>): string {
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
  const secs = (ms: unknown) => `${(n(ms) / 1000).toFixed(1)} s`;
  switch (type) {
    case "FAST_ANSWER":
      return `Answered correctly in ${secs(d.responseMs)} (reading the question takes at least ${secs(d.minimumMs)}).`;
    case "ATTEMPT_LOCKED": {
      const reasons: Record<string, string> = { LEFT_PAGE: "left the page/app", FULLSCREEN_EXIT: "exited fullscreen", RELOADED: "reloaded the page", SECOND_DEVICE: "opened it on another device" };
      const events = d.events && typeof d.events === "object" ? Object.entries(d.events as Record<string, number>).map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} ×${v}`).join(", ") : "";
      return `Attempt ended: ${reasons[String(d.reason)] ?? String(d.reason)} ${n(d.secondsAfterStart)} s after Start${events ? ` · signals: ${events}` : ""}.`;
    }
    case "SAME_WRONG_ANSWERS": {
      const partners = Array.isArray(d.partners) ? (d.partners as { name: string; days: number[] }[]) : [];
      return partners.map((p) => `Same rare wrong answer as ${p.name} on ${p.days.length} days (${p.days.join(", ")})`).join(" · ") + ".";
    }
    case "MULTIPLE_ACCOUNTS":
      return `${n(d.accounts)} accounts answered from IP ${String(d.ip ?? "?")}.`;
    case "RAPID_SUBMISSIONS":
      return `${n(d.clusterSize)} accounts on IP ${String(d.ip ?? "?")} submitted within ${n(d.windowSeconds)} s.`;
    case "SUSPICIOUS_ACTIVITY":
      return `Signed in from ${n(d.distinctIps24h)} different IPs in 24 hours.`;
    default:
      return JSON.stringify(d);
  }
}

/**
 * Collusion signal: pairs of participants who repeatedly choose the same *rare* wrong
 * answer. Popular wrong answers (a tricky question most people get wrong the same way)
 * are ignored, so honest people aren't paired up by accident. Recomputed from all closed
 * days each run; open flags get their evidence refreshed, reviewed flags are left alone.
 */
export async function detectSameWrongAnswers(comp: ICompetition, throughDay: number) {
  await connectDb();
  const answers = await DailyAnswer.find({ competitionId: comp._id, dayNumber: { $lte: throughDay }, status: "ANSWERED" })
    .select("userId dayNumber isCorrect selectedOptionId selectedOptionIds questionId")
    .lean();

  // day → { total answerers, wrong-choice key → users }
  const days = new Map<number, { total: number; wrong: Map<string, string[]> }>();
  for (const a of answers) {
    const day = days.get(a.dayNumber) ?? { total: 0, wrong: new Map() };
    day.total += 1;
    if (a.isCorrect === false) {
      // Include the question id: with question pools, same letters on different questions mean nothing.
      const key = `${String(a.questionId)}:${[...selectedIdsOf(a)].sort().join("")}`;
      const list = day.wrong.get(key) ?? [];
      list.push(String(a.userId));
      day.wrong.set(key, list);
    }
    days.set(a.dayNumber, day);
  }

  const pairs = new Map<string, number[]>(); // "userA|userB" (sorted) → days shared
  for (const [dayNumber, day] of days) {
    for (const users of day.wrong.values()) {
      if (users.length < 2 || users.length / day.total > ANTICHEAT_THRESHOLDS.rareWrongShare) continue;
      const sorted = [...new Set(users)].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]}|${sorted[j]}`;
          pairs.set(key, [...(pairs.get(key) ?? []), dayNumber]);
        }
      }
    }
  }

  // user → partners with their shared days
  const byUser = new Map<string, { partnerId: string; days: number[] }[]>();
  for (const [key, shared] of pairs) {
    if (shared.length < ANTICHEAT_THRESHOLDS.sharedWrongDays) continue;
    const [a, b] = key.split("|") as [string, string];
    const sortedDays = [...shared].sort((x, y) => x - y);
    byUser.set(a, [...(byUser.get(a) ?? []), { partnerId: b, days: sortedDays }]);
    byUser.set(b, [...(byUser.get(b) ?? []), { partnerId: a, days: sortedDays }]);
  }
  if (!byUser.size) return 0;

  const people = await User.find({ _id: { $in: [...byUser.keys()] } }).select("name email").lean();
  const names = new Map(people.map((p) => [String(p._id), p.name]));
  let raised = 0;
  for (const [userId, partners] of byUser) {
    const details = {
      partners: partners
        .sort((x, y) => y.days.length - x.days.length)
        .map((p) => ({ userId: p.partnerId, name: names.get(p.partnerId) ?? "Deleted user", days: p.days })),
    };
    const res = await SuspicionFlag.updateOne(
      { competitionId: comp._id, userId, type: "SAME_WRONG_ANSWERS", dayNumber: null, status: "OPEN" },
      { $set: { details }, $setOnInsert: { competitionId: comp._id, userId, type: "SAME_WRONG_ANSWERS", dayNumber: null, status: "OPEN" } },
      { upsert: true },
    ).catch((e) => {
      // A reviewed (non-OPEN) flag for this user already holds the unique slot: leave it alone.
      if (isDuplicateKeyError(e)) return null;
      throw e;
    });
    if (res?.upsertedCount) raised += 1;
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
