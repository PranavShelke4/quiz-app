import type { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors";
import { rankParticipants, type Ranked, type RankableParticipant } from "@/lib/leaderboard/ranking";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { escapeRegex } from "@/lib/validation/common";
import { Competition, type ICompetition } from "@/models/Competition";
import { CompetitionParticipant, type ICompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { User } from "@/models/User";
import { recordAudit } from "@/services/audit.service";
import {
  automaticRevealDue,
  clockFor,
  getCompetitionById,
  getCurrentCompetition,
  isLeaderboardRevealed,
  toPublicCompetition,
} from "@/services/competition.service";
import { notifyResultsRevealed } from "@/services/notification.service";
import { ensureMissedRecords, recalculateAllParticipants } from "@/services/participant.service";

type Actor = { userId: Types.ObjectId; meta: Pick<RequestMeta, "ip" | "userAgent"> };

function toRankable(p: ICompetitionParticipant): RankableParticipant & { participant: ICompetitionParticipant } {
  return {
    userId: String(p.userId),
    totalScore: p.totalScore,
    correctAnswers: p.correctAnswers,
    missedDays: p.missedDays,
    totalResponseTimeMs: p.totalResponseTimeMs,
    lastAnsweredAt: p.lastAnsweredAt,
    joinedAt: p.joinedAt,
    participant: p,
  };
}

/**
 * Freezes final results once the competition has ended:
 *  1. materialise MISSED for every closed day (full scan, repairs cron gaps)
 *  2. rebuild every participant's stats from answer records
 *  3. rank deterministically and store finalRank/finalScore/...
 * Idempotent; re-run after corrections.
 */
export async function finalizeCompetition(compId: Types.ObjectId | string, options: { actor?: Actor; at?: Date } = {}) {
  await connectDb();
  const at = options.at ?? now();
  const comp = await getCompetitionById(compId);
  if (clockFor(comp, at).phase !== "ENDED") throw new AppError("LEADERBOARD_NOT_AVAILABLE", "The competition hasn't ended yet.");

  await ensureMissedRecords(comp, { throughDay: comp.durationDays });
  await recalculateAllParticipants(comp, at);

  const participants = await CompetitionParticipant.find({ competitionId: comp._id }).lean();
  const ranked = rankParticipants(participants.map(toRankable), comp.tieBreakers);
  for (let i = 0; i < ranked.length; i += 1000) {
    await CompetitionParticipant.bulkWrite(
      ranked.slice(i, i + 1000).map((r) => ({
        updateOne: {
          filter: { _id: r.participant._id },
          update: {
            $set: {
              finalRank: r.rank,
              finalScore: r.participant.totalScore,
              finalCorrect: r.participant.correctAnswers,
              finalWrong: r.participant.wrongAnswers,
              finalMissed: r.participant.missedDays,
              finalizedAt: at,
            },
          },
        },
      })),
    );
  }
  await Competition.updateOne(
    { _id: comp._id },
    { $set: { finalizedAt: at, missedProcessedThroughDay: comp.durationDays, status: comp.status === "ARCHIVED" ? "ARCHIVED" : "COMPLETED", completedAt: comp.completedAt ?? at } },
  );
  if (options.actor) {
    await recordAudit({ adminId: options.actor.userId, action: "COMPETITION_FINALIZED", targetType: "Competition", targetId: comp._id, metadata: { participants: ranked.length }, meta: options.actor.meta });
  }
  return { participants: ranked.length };
}

/** Ensures an ended competition is finalized and, if due, automatically revealed. */
export async function ensureCompletionState(comp: ICompetition, at: Date = now()): Promise<{ comp: ICompetition; revealedNow: boolean }> {
  if (clockFor(comp, at).phase !== "ENDED") return { comp, revealedNow: false };
  if (!comp.finalizedAt) await finalizeCompetition(comp._id, { at });
  let revealedNow = false;
  const fresh = await getCompetitionById(comp._id);
  if (automaticRevealDue(fresh, at)) {
    const res = await Competition.updateOne(
      { _id: fresh._id, leaderboardRevealed: false, leaderboardRevealOverridden: false },
      { $set: { leaderboardRevealed: true, leaderboardRevealedAt: at } },
    );
    revealedNow = res.modifiedCount === 1;
    if (revealedNow) {
      await recordAudit({ adminId: null, action: "LEADERBOARD_REVEALED", targetType: "Competition", targetId: fresh._id, metadata: { automatic: true } });
      await notifyResultsRevealed(fresh);
    }
  }
  return { comp: await getCompetitionById(comp._id), revealedNow };
}

export async function revealLeaderboard(compId: string, actor: Actor) {
  await connectDb();
  let comp = await getCompetitionById(compId);
  if (clockFor(comp).phase !== "ENDED") {
    // Hard rule: correctness can never be exposed while the competition is running.
    throw new AppError("LEADERBOARD_NOT_AVAILABLE", "The leaderboard can only be revealed after the competition ends.");
  }
  if (!comp.finalizedAt) {
    await finalizeCompetition(comp._id, { actor });
    comp = await getCompetitionById(compId);
  }
  await Competition.updateOne(
    { _id: comp._id },
    { $set: { leaderboardRevealed: true, leaderboardRevealedAt: now(), leaderboardRevealOverridden: true } },
  );
  await recordAudit({ adminId: actor.userId, action: "LEADERBOARD_REVEALED", targetType: "Competition", targetId: comp._id, metadata: { automatic: false }, meta: actor.meta });
  // Dedupe keys guarantee participants are notified at most once per competition.
  await notifyResultsRevealed(comp);
  return getCompetitionById(comp._id);
}

export async function hideLeaderboard(compId: string, actor: Actor) {
  await connectDb();
  const comp = await getCompetitionById(compId);
  await Competition.updateOne({ _id: comp._id }, { $set: { leaderboardRevealed: false, leaderboardRevealOverridden: true } });
  await recordAudit({ adminId: actor.userId, action: "LEADERBOARD_HIDDEN", targetType: "Competition", targetId: comp._id, meta: actor.meta });
  return getCompetitionById(comp._id);
}

// ---------------------------------------------------------------------------
// Public leaderboard (after reveal only)
// ---------------------------------------------------------------------------

export interface LeaderboardEntryDTO {
  rank: number;
  name: string;
  avatar: string | null;
  isMe: boolean;
  score: number;
  correct: number;
  wrong: number;
  missed: number;
  accuracy: number;
  completion: number;
  currentStreak: number;
  longestStreak: number;
}

function toEntry(p: ICompetitionParticipant, user: { name: string; avatar: string | null } | undefined, comp: ICompetition, meId?: string): LeaderboardEntryDTO {
  const correct = p.finalCorrect ?? p.correctAnswers;
  const wrong = p.finalWrong ?? p.wrongAnswers;
  const answered = correct + wrong;
  return {
    rank: p.finalRank ?? 0,
    name: user?.name ?? "Former participant",
    avatar: user?.avatar ?? null,
    isMe: String(p.userId) === meId,
    score: p.finalScore ?? p.totalScore,
    correct,
    wrong,
    missed: p.finalMissed ?? p.missedDays,
    accuracy: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
    completion: Math.round((answered / comp.durationDays) * 1000) / 10,
    currentStreak: p.currentStreak,
    longestStreak: p.longestStreak,
  };
}

export type LockedLeaderboard = { daysRemaining: number; endsAt: string; phase: string };

/** Throws LEADERBOARD_LOCKED (with lock details) until results are revealed. */
export async function getPublicLeaderboard(params: { userId?: Types.ObjectId; page: number; pageSize: number; at?: Date }) {
  await connectDb();
  const at = params.at ?? now();
  let comp = await getCurrentCompetition(at);
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  comp = (await ensureCompletionState(comp, at)).comp;
  const clock = clockFor(comp, at);

  if (!isLeaderboardRevealed(comp, at)) {
    const details: LockedLeaderboard = { daysRemaining: clock.daysRemaining, endsAt: clock.endsAt.toISOString(), phase: clock.phase };
    throw new AppError("LEADERBOARD_LOCKED", undefined, details);
  }

  const filter = { competitionId: comp._id, finalRank: { $ne: null } };
  const [rows, total] = await Promise.all([
    CompetitionParticipant.find(filter).sort({ finalRank: 1, userId: 1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean(),
    CompetitionParticipant.countDocuments(filter),
  ]);
  const me = params.userId ? await CompetitionParticipant.findOne({ competitionId: comp._id, userId: params.userId }).lean() : null;
  const userIds = [...rows.map((r) => r.userId), ...(me ? [me.userId] : [])];
  const users = await User.find({ _id: { $in: userIds } }).select("name avatar").lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const meId = params.userId ? String(params.userId) : undefined;

  return {
    competition: toPublicCompetition(comp, at),
    entries: rows.map((r) => toEntry(r, userMap.get(String(r.userId)), comp, meId)),
    me: me ? toEntry(me, userMap.get(String(me.userId)), comp, meId) : null,
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/** Per-day review for the signed-in user — only after reveal. */
export async function getUserResults(userId: Types.ObjectId, at: Date = now()) {
  await connectDb();
  let comp = await getCurrentCompetition(at);
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  comp = (await ensureCompletionState(comp, at)).comp;
  if (!isLeaderboardRevealed(comp, at)) throw new AppError("LEADERBOARD_LOCKED");

  const [questions, answers, participant] = await Promise.all([
    Question.find({ competitionId: comp._id, status: "PUBLISHED" }).sort({ dayNumber: 1 }).lean(),
    DailyAnswer.find({ competitionId: comp._id, userId }).lean(),
    CompetitionParticipant.findOne({ competitionId: comp._id, userId }).lean(),
  ]);
  const answerByDay = new Map(answers.map((a) => [a.dayNumber, a]));
  const days = questions.map((q) => {
    const a = answerByDay.get(q.dayNumber);
    return {
      dayNumber: q.dayNumber,
      questionText: q.questionText,
      category: q.category,
      difficulty: q.difficulty,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
      correctOptionId: q.correctOptionId,
      explanation: q.explanation,
      selectedOptionId: a?.selectedOptionId ?? null,
      result: !a || a.status === "MISSED" ? ("MISSED" as const) : a.isCorrect ? ("CORRECT" as const) : ("WRONG" as const),
      points: a?.score ?? 0,
      answeredAt: a?.answeredAt?.toISOString() ?? null,
    };
  });
  const totalParticipants = await CompetitionParticipant.countDocuments({ competitionId: comp._id });
  return {
    competition: toPublicCompetition(comp, at),
    summary: participant
      ? {
          ...toEntry(participant, undefined, comp, String(userId)),
          totalParticipants,
          maxScore: questions.reduce((s, q) => s + (q.points ?? comp.scoring.pointsPerCorrectAnswer), 0),
        }
      : null,
    days,
  };
}

// ---------------------------------------------------------------------------
// Admin leaderboard — available any time (admins may see live standings).
// ---------------------------------------------------------------------------
export type AdminLeaderboardSort = "rank" | "score" | "correct" | "wrong" | "missed" | "accuracy" | "streak";

export async function getAdminLeaderboard(params: {
  competitionId: string;
  search?: string;
  sort?: AdminLeaderboardSort;
  dir?: "asc" | "desc";
  page: number;
  pageSize: number;
}) {
  await connectDb();
  const comp = await getCompetitionById(params.competitionId);
  const participants = await CompetitionParticipant.find({ competitionId: comp._id }).lean();
  const users = await User.find({ _id: { $in: participants.map((p) => p.userId) } }).select("name email avatar isActive").lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  // Live rank with the competition's configured tie-breakers (final rank once frozen).
  const live: Ranked<ReturnType<typeof toRankable>>[] = comp.finalizedAt
    ? participants.map((p) => ({ ...toRankable(p), rank: p.finalRank ?? 0 }))
    : rankParticipants(participants.map(toRankable), comp.tieBreakers);

  let rows = live.map((r) => {
    const p = r.participant;
    const u = userMap.get(String(p.userId));
    const answered = p.correctAnswers + p.wrongAnswers;
    return {
      userId: String(p.userId),
      rank: r.rank,
      name: u?.name ?? "Deleted user",
      email: u?.email ?? "",
      isActive: u?.isActive ?? false,
      score: p.totalScore,
      correct: p.correctAnswers,
      wrong: p.wrongAnswers,
      missed: p.missedDays,
      answered,
      accuracy: answered ? Math.round((p.correctAnswers / answered) * 1000) / 10 : 0,
      completion: Math.round((answered / comp.durationDays) * 1000) / 10,
      currentStreak: p.currentStreak,
      longestStreak: p.longestStreak,
      joinedAt: p.joinedAt.toISOString(),
    };
  });

  if (params.search) {
    const re = new RegExp(escapeRegex(params.search), "i");
    rows = rows.filter((r) => re.test(r.name) || re.test(r.email));
  }
  const sort = params.sort ?? "rank";
  const dir = params.dir ?? (sort === "rank" ? "asc" : "desc");
  const key: Record<AdminLeaderboardSort, (r: (typeof rows)[number]) => number> = {
    rank: (r) => r.rank,
    score: (r) => r.score,
    correct: (r) => r.correct,
    wrong: (r) => r.wrong,
    missed: (r) => r.missed,
    accuracy: (r) => r.accuracy,
    streak: (r) => r.longestStreak,
  };
  rows.sort((a, b) => (dir === "asc" ? key[sort](a) - key[sort](b) : key[sort](b) - key[sort](a)) || a.rank - b.rank);

  return {
    competition: comp,
    rows: rows.slice((params.page - 1) * params.pageSize, params.page * params.pageSize),
    allRows: rows,
    total: rows.length,
  };
}
