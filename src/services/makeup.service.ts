import { Types } from "mongoose";
import { connectDb, withTransaction } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors";
import { antiCheatOf } from "@/lib/quiz/anticheat-config";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { Competition } from "@/models/Competition";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { QuizAttempt } from "@/models/QuizAttempt";
import { recordAudit } from "@/services/audit.service";
import { clockFor } from "@/services/competition.service";
import { recalculateParticipantStats } from "@/services/participant.service";

type Actor = { userId: Types.ObjectId; meta: Pick<RequestMeta, "ip" | "userAgent"> };

export type AdminDayState = "ANSWERED" | "MISSED" | "LOCKED" | "OPEN" | "REOPENED" | "UPCOMING";

/** Per-day status of one participant, for the admin user page. */
export async function getParticipantDays(competitionId: Types.ObjectId, userId: Types.ObjectId, at: Date = now()) {
  const comp = await Competition.findById(competitionId).lean();
  if (!comp) return null;
  const clock = clockFor(comp, at);
  const [participant, answers, attempts] = await Promise.all([
    CompetitionParticipant.findOne({ competitionId, userId }).select("makeupDays").lean(),
    DailyAnswer.find({ competitionId, userId }).select("dayNumber status isCorrect").lean(),
    QuizAttempt.find({ competitionId, userId }).select("dayNumber status lockReason").lean(),
  ]);
  const answerBy = new Map(answers.map((a) => [a.dayNumber, a]));
  const attemptBy = new Map(attempts.map((a) => [a.dayNumber, a]));
  const reopened = new Set(participant?.makeupDays ?? []);
  const currentDay = clock.phase === "ACTIVE" ? clock.currentDay! : clock.phase === "ENDED" ? comp.durationDays + 1 : 0;
  const days = Array.from({ length: comp.durationDays }, (_, i) => {
    const dayNumber = i + 1;
    const a = answerBy.get(dayNumber);
    const t = attemptBy.get(dayNumber);
    let state: AdminDayState;
    if (a?.status === "ANSWERED") state = "ANSWERED";
    else if (reopened.has(dayNumber) && dayNumber < currentDay) state = "REOPENED";
    else if (dayNumber > currentDay) state = "UPCOMING";
    else if (t && (t.status === "LOCKED" || t.status === "EXPIRED")) state = "LOCKED";
    else if (a?.status === "MISSED") state = "MISSED";
    else state = dayNumber === currentDay ? "OPEN" : "MISSED";
    return { dayNumber, state, lockReason: t?.lockReason ?? null };
  });
  return {
    days,
    currentDay: clock.phase === "ACTIVE" ? clock.currentDay : null,
    // Re-opening only makes sense while the competition is live and in timed mode (past days).
    canReopen: clock.phase === "ACTIVE",
    timedMode: antiCheatOf(comp).enabled,
  };
}

/**
 * Gives one participant another chance at a day they didn't answer:
 *  - today: clears the MISSED record and the ended attempt, so today's question shows again;
 *  - an earlier (closed) day: clears its ended attempt and adds it to the participant's
 *    make-up days; the MISSED record stays until they answer (timed mode only).
 * Answered days are never touched. Everything happens in one transaction, with an audit entry.
 */
export async function reopenDayForUser(params: { competitionId: string; userId: string; dayNumber: number; actor: Actor; at?: Date }) {
  await connectDb();
  const at = params.at ?? now();
  if (!Types.ObjectId.isValid(params.competitionId) || !Types.ObjectId.isValid(params.userId)) throw new AppError("NOT_FOUND");
  const comp = await Competition.findById(params.competitionId).lean();
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  const userId = new Types.ObjectId(params.userId);
  const day = params.dayNumber;
  const clock = clockFor(comp, at);
  if (clock.phase !== "ACTIVE" || clock.currentDay === null) throw new AppError("CONFLICT", "Days can only be re-opened while the competition is running.");
  if (!Number.isInteger(day) || day < 1 || day > clock.currentDay) throw new AppError("CONFLICT", "Only today or an earlier day can be re-opened.");
  const isToday = day === clock.currentDay;
  if (!isToday && !antiCheatOf(comp).enabled) throw new AppError("CONFLICT", "Earlier days can only be re-opened when timed attempts are enabled.");
  if (isToday && clock.today && at.getTime() >= clock.today.closesAt.getTime()) throw new AppError("CONFLICT", "Today's question has already closed.");

  const participant = await CompetitionParticipant.findOne({ competitionId: comp._id, userId }).lean();
  if (!participant) throw new AppError("NOT_FOUND", "This user hasn't joined the competition.");
  const answer = await DailyAnswer.findOne({ competitionId: comp._id, userId, dayNumber: day }).lean();
  if (answer?.status === "ANSWERED") throw new AppError("CONFLICT", `Day ${day} is already answered.`);
  const attempt = await QuizAttempt.findOne({ competitionId: comp._id, userId, dayNumber: day }).lean();
  if (attempt?.status === "STARTED") throw new AppError("CONFLICT", `An attempt for day ${day} is running right now.`);

  await withTransaction(async (session) => {
    await QuizAttempt.deleteOne({ competitionId: comp._id, userId, dayNumber: day, status: { $in: ["LOCKED", "EXPIRED"] } }, { session });
    if (isToday) {
      await DailyAnswer.deleteOne({ competitionId: comp._id, userId, dayNumber: day, status: "MISSED" }, { session });
    } else {
      await CompetitionParticipant.updateOne({ _id: participant._id }, { $addToSet: { makeupDays: day } }, { session });
    }
    await recalculateParticipantStats(comp, userId, { session, at });
    await recordAudit(
      {
        adminId: params.actor.userId,
        action: "DAY_REOPENED",
        targetType: "DailyAnswer",
        targetId: `${comp._id}:${userId}:${day}`,
        metadata: { dayNumber: day, mode: isToday ? "today-reset" : "makeup", previousStatus: answer?.status ?? null, previousAttemptStatus: attempt?.status ?? null, previousLockReason: attempt?.lockReason ?? null },
        meta: params.actor.meta,
      },
      session,
    );
  });
  return { ok: true, dayNumber: day, mode: isToday ? ("today-reset" as const) : ("makeup" as const) };
}

/** Withdraws a re-opened earlier day that hasn't been used yet. */
export async function cancelReopenedDay(params: { competitionId: string; userId: string; dayNumber: number; actor: Actor }) {
  await connectDb();
  if (!Types.ObjectId.isValid(params.competitionId) || !Types.ObjectId.isValid(params.userId)) throw new AppError("NOT_FOUND");
  const competitionId = new Types.ObjectId(params.competitionId);
  const userId = new Types.ObjectId(params.userId);
  const res = await CompetitionParticipant.updateOne({ competitionId, userId }, { $pull: { makeupDays: params.dayNumber } });
  if (res.modifiedCount === 1) {
    await recordAudit({
      adminId: params.actor.userId,
      action: "DAY_REOPENED",
      targetType: "DailyAnswer",
      targetId: `${competitionId}:${userId}:${params.dayNumber}`,
      metadata: { dayNumber: params.dayNumber, mode: "cancelled" },
      meta: params.actor.meta,
    });
  }
  return { ok: true };
}
