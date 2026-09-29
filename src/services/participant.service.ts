import { Types, type ClientSession } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { computeParticipantStats, type ParticipantStats } from "@/lib/quiz/stats";
import { now } from "@/lib/time/clock";
import type { ICompetition } from "@/models/Competition";
import { CompetitionParticipant, type ICompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { clockFor, isRegistrationOpen } from "@/services/competition.service";

/**
 * Days are only marked MISSED once they have been closed for this long, so a
 * submission accepted at 23:59:59.9 is always committed before rollover runs.
 */
export const MISSED_GRACE_MS = 2 * 60_000;

export function lastRolloverDay(comp: ICompetition, at: Date = now()): number {
  return clockFor(comp, new Date(at.getTime() - MISSED_GRACE_MS)).lastClosedDay;
}

type CompRef = Pick<ICompetition, "_id" | "startDate" | "durationDays" | "timezone">;

/** Rebuilds a participant's aggregates from DailyAnswer (the source of truth). */
export async function recalculateParticipantStats(
  comp: CompRef,
  userId: Types.ObjectId,
  options: { session?: ClientSession; at?: Date } = {},
): Promise<ParticipantStats> {
  const answers = await DailyAnswer.find({ competitionId: comp._id, userId })
    .select("dayNumber status isCorrect score answeredAt responseTimeMs")
    .session(options.session ?? null)
    .lean();
  const stats = computeParticipantStats(answers, clockFor(comp, options.at ?? now()));
  await CompetitionParticipant.updateOne(
    { competitionId: comp._id, userId },
    { $set: stats },
    options.session ? { session: options.session } : {},
  );
  return stats;
}

/** Rebuild every participant (admin "repair stats" and finalization). */
export async function recalculateAllParticipants(comp: CompRef, at: Date = now()): Promise<number> {
  await connectDb();
  const participants = await CompetitionParticipant.find({ competitionId: comp._id }).select("userId").lean();
  await runWithConcurrency(participants, 16, (p) => recalculateParticipantStats(comp, p.userId, { at }));
  return participants.length;
}

export async function runWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<unknown>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function publishedQuestionDays(competitionId: Types.ObjectId, session?: ClientSession) {
  const qs = await Question.find({ competitionId, status: "PUBLISHED" }).select("dayNumber").session(session ?? null).lean();
  return new Map(qs.map((q) => [q.dayNumber, q._id]));
}

/**
 * Ensures a MISSED record exists for every (participant, closed day) pair that has
 * no record. Idempotent and race-safe: the unique index makes an answer and a
 * MISSED record for the same day mutually exclusive. Returns affected users.
 */
export async function ensureMissedRecords(
  comp: ICompetition,
  params: { throughDay: number; fromDay?: number; userIds?: Types.ObjectId[]; session?: ClientSession },
): Promise<Types.ObjectId[]> {
  const fromDay = Math.max(1, params.fromDay ?? 1);
  if (params.throughDay < fromDay) return [];
  const questionDays = await publishedQuestionDays(comp._id, params.session);
  const days: number[] = [];
  for (let d = fromDay; d <= params.throughDay; d++) if (questionDays.has(d)) days.push(d);
  if (!days.length) return [];

  const userIds =
    params.userIds ??
    (await CompetitionParticipant.find({ competitionId: comp._id }).select("userId").session(params.session ?? null).lean()).map((p) => p.userId);
  if (!userIds.length) return [];

  const existing = await DailyAnswer.find({ competitionId: comp._id, userId: { $in: userIds }, dayNumber: { $in: days } })
    .select("userId dayNumber")
    .session(params.session ?? null)
    .lean();
  const have = new Set(existing.map((e) => `${String(e.userId)}:${e.dayNumber}`));

  const toInsert = [];
  for (const userId of userIds) {
    for (const day of days) {
      if (!have.has(`${String(userId)}:${day}`)) {
        toInsert.push({
          competitionId: comp._id,
          userId,
          dayNumber: day,
          questionId: questionDays.get(day) ?? null,
          selectedOptionId: null,
          isCorrect: null,
          score: 0,
          status: "MISSED" as const,
        });
      }
    }
  }
  if (!toInsert.length) return [];

  const affected = new Set<string>();
  for (let i = 0; i < toInsert.length; i += 1000) {
    const chunk = toInsert.slice(i, i + 1000);
    try {
      await DailyAnswer.insertMany(chunk, { ordered: false, ...(params.session ? { session: params.session } : {}) });
      chunk.forEach((c) => affected.add(String(c.userId)));
    } catch (e) {
      // A concurrent writer created some of these: duplicates are expected and safe.
      if (!isDuplicateKeyError(e) && !(e as { writeErrors?: unknown[] }).writeErrors) throw e;
      chunk.forEach((c) => affected.add(String(c.userId)));
    }
  }
  return [...affected].map((id) => new Types.ObjectId(id));
}

/** Lazy self-healing for one user: fills any closed-day gaps (e.g. if cron didn't run). */
export async function repairUserMissedDays(comp: ICompetition, userId: Types.ObjectId, at: Date = now()) {
  const throughDay = lastRolloverDay(comp, at);
  if (throughDay < 1) return;
  const recorded = await DailyAnswer.countDocuments({ competitionId: comp._id, userId, dayNumber: { $lte: throughDay } });
  if (recorded >= throughDay) return;
  const affected = await ensureMissedRecords(comp, { throughDay, userIds: [userId] });
  if (affected.length) await recalculateParticipantStats(comp, userId, { at });
}

export async function getParticipant(competitionId: Types.ObjectId, userId: Types.ObjectId) {
  await connectDb();
  return CompetitionParticipant.findOne({ competitionId, userId }).lean();
}

/**
 * Joins the user to the competition. Days that already closed are recorded as
 * MISSED immediately so late joiners can never answer them.
 */
export async function joinCompetition(
  comp: ICompetition,
  userId: Types.ObjectId,
  options: { session?: ClientSession; at?: Date } = {},
): Promise<ICompetitionParticipant> {
  const at = options.at ?? now();
  const existing = await CompetitionParticipant.findOne({ competitionId: comp._id, userId }).session(options.session ?? null).lean();
  if (existing) return existing;
  if (!isRegistrationOpen(comp, at)) throw new AppError("REGISTRATION_CLOSED");

  try {
    await CompetitionParticipant.create([{ competitionId: comp._id, userId, joinedAt: at }], options.session ? { session: options.session } : {});
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
  }
  const throughDay = lastRolloverDay(comp, at);
  if (throughDay >= 1) {
    await ensureMissedRecords(comp, { throughDay, userIds: [userId], session: options.session });
  }
  await recalculateParticipantStats(comp, userId, { session: options.session, at });
  const participant = await CompetitionParticipant.findOne({ competitionId: comp._id, userId }).session(options.session ?? null).lean();
  return participant!;
}
