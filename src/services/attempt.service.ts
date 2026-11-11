import { randomInt } from "node:crypto";
import type { ClientSession, Types } from "mongoose";
import { connectDb, withTransaction } from "@/lib/db/mongoose";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { LEAVE_EVENTS, antiCheatOf, type AttemptEventType, type LockReason } from "@/lib/quiz/anticheat-config";
import { correctIdsOf } from "@/lib/quiz/scoring";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { OPTION_IDS, type OptionId } from "@/lib/validation/quiz";
import type { ICompetition } from "@/models/Competition";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question, type IQuestion } from "@/models/Question";
import { QuizAttempt, type IQuizAttempt } from "@/models/QuizAttempt";
import { SuspicionFlag } from "@/models/SuspicionFlag";
import { User } from "@/models/User";
import { clockFor, getCurrentCompetition } from "@/services/competition.service";
import { questionForParticipant } from "@/services/pool.service";
import { getParticipant, recalculateParticipantStats } from "@/services/participant.service";

/**
 * Timed attempts (anti-cheat mode).
 *
 *  - The question text/options are only sent after Start, together with a server deadline.
 *  - Option order can be shuffled per participant. The client only ever sees *display*
 *    ids (A, B, C… by position); the server maps them back to the real ids, so the real
 *    answer key letters never reach the browser.
 *  - Leaving the page, a reload or a second device ends the attempt as MISSED and raises
 *    a review flag with the evidence. A missed deadline also ends it (without a flag).
 */

type Meta = Pick<RequestMeta, "ip" | "userAgent">;
export type AttemptView = Pick<IQuizAttempt, "optionOrder" | "deadlineAt" | "startedAt" | "status" | "lockReason">;

function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Real option id → the letter this participant sees, and back. */
export function displayMapping(optionOrder: readonly string[]) {
  const toDisplay = new Map(optionOrder.map((real, i) => [real, OPTION_IDS[i]!]));
  const toReal = new Map(optionOrder.map((real, i) => [OPTION_IDS[i]!, real as OptionId]));
  return { toDisplay: (id: string) => toDisplay.get(id) ?? (id as OptionId), toReal: (id: string) => toReal.get(id as OptionId) };
}

/** Options in this participant's order, relabelled A, B, C… */
export function displayOptions(q: Pick<IQuestion, "options">, optionOrder: readonly string[]) {
  const byId = new Map(q.options.map((o) => [o.id, o.text]));
  return optionOrder.map((real, i) => ({ id: OPTION_IDS[i]!, text: byId.get(real as OptionId) ?? "" }));
}

async function loadToday(userId: Types.ObjectId, at: Date) {
  const comp = await getCurrentCompetition(at);
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  const clock = clockFor(comp, at);
  if (clock.phase === "NOT_STARTED") throw new AppError("COMPETITION_NOT_STARTED");
  if (clock.phase === "ENDED" || !clock.today || clock.currentDay === null) throw new AppError("COMPETITION_ENDED");
  if (!(await getParticipant(comp._id, userId))) throw new AppError("NOT_PARTICIPANT", "Join the competition before answering.");
  return { comp, dayNumber: clock.currentDay, window: clock.today };
}

/** Ends a STARTED attempt and records the day as MISSED (0 points). Idempotent. */
async function endAttempt(
  comp: ICompetition,
  attempt: Pick<IQuizAttempt, "_id" | "userId" | "dayNumber" | "questionId" | "startedAt" | "events">,
  outcome: { status: "LOCKED"; reason: LockReason } | { status: "EXPIRED" },
  at: Date,
) {
  const ended = await withTransaction(async (session: ClientSession) => {
    const res = await QuizAttempt.updateOne(
      { _id: attempt._id, status: "STARTED" },
      { $set: { status: outcome.status, lockReason: outcome.status === "LOCKED" ? outcome.reason : null, endedAt: at } },
      { session },
    );
    if (res.modifiedCount !== 1) return false; // already submitted/ended by a concurrent request
    try {
      await DailyAnswer.create(
        [{ competitionId: comp._id, userId: attempt.userId, dayNumber: attempt.dayNumber, questionId: attempt.questionId, selectedOptionId: null, isCorrect: null, score: 0, status: "MISSED" }],
        { session },
      );
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
    }
    await recalculateParticipantStats(comp, attempt.userId, { session, at });
    return true;
  });
  if (ended && outcome.status === "LOCKED") {
    const counts: Record<string, number> = {};
    for (const e of attempt.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    try {
      await SuspicionFlag.create({
        competitionId: comp._id,
        userId: attempt.userId,
        type: "ATTEMPT_LOCKED",
        dayNumber: attempt.dayNumber,
        details: { reason: outcome.reason, secondsAfterStart: Math.round((at.getTime() - attempt.startedAt.getTime()) / 1000), events: counts },
      });
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
    }
  }
  return ended;
}

/** Ends attempts whose deadline has passed (lazy: called whenever an attempt is read). */
export async function expireIfDue(comp: ICompetition, attempt: IQuizAttempt, at: Date = now()): Promise<IQuizAttempt> {
  if (attempt.status !== "STARTED" || at.getTime() <= attempt.deadlineAt.getTime() + 2_000) return attempt;
  await endAttempt(comp, attempt, { status: "EXPIRED" }, at);
  return (await QuizAttempt.findById(attempt._id).lean())!;
}

export async function lockAttempt(comp: ICompetition, attempt: IQuizAttempt, reason: LockReason, at: Date = now()) {
  await endAttempt(comp, attempt, { status: "LOCKED", reason }, at);
  return (await QuizAttempt.findById(attempt._id).lean())!;
}

export function startedPayload(q: IQuestion, comp: ICompetition, attempt: IQuizAttempt) {
  return {
    question: {
      id: String(q._id),
      dayNumber: q.dayNumber,
      questionText: q.questionText,
      options: displayOptions(q, attempt.optionOrder),
      multiSelect: correctIdsOf(q).length > 1,
      points: q.points ?? comp.scoring.pointsPerCorrectAnswer,
      category: q.category,
      difficulty: q.difficulty,
    },
    startedAt: attempt.startedAt.toISOString(),
    deadlineAt: attempt.deadlineAt.toISOString(),
    serverTime: now().toISOString(),
  };
}

/**
 * Starts (or, when allowed, resumes) today's attempt. A second Start while an attempt is
 * running means a reload, another tab or another device: with lockOnLeave that ends it.
 */
export async function startAttempt(params: { userId: Types.ObjectId; sessionId: Types.ObjectId | null; meta?: Meta; at?: Date }) {
  await connectDb();
  const at = params.at ?? now();
  const { comp, dayNumber, window } = await loadToday(params.userId, at);
  const ac = antiCheatOf(comp);
  if (!ac.enabled) throw new AppError("CONFLICT", "Timed attempts aren't enabled for this competition.");
  if (at.getTime() < window.opensAt.getTime()) throw new AppError("QUESTION_NOT_AVAILABLE");
  if (at.getTime() >= window.closesAt.getTime()) throw new AppError("QUESTION_EXPIRED");
  const user = await User.findById(params.userId).select("isActive").lean();
  if (!user?.isActive) throw new AppError("USER_DISABLED");

  const answered = await DailyAnswer.findOne({ competitionId: comp._id, userId: params.userId, dayNumber }).select("status").lean();
  if (answered) throw new AppError(answered.status === "ANSWERED" ? "ANSWER_ALREADY_SUBMITTED" : "ATTEMPT_LOCKED");

  const existing = await QuizAttempt.findOne({ competitionId: comp._id, userId: params.userId, dayNumber }).lean();
  // A running attempt keeps its question; a new one gets this participant's pool version.
  const question = existing ? await Question.findById(existing.questionId).lean() : await questionForParticipant(comp._id, dayNumber, params.userId);
  if (!question) throw new AppError("QUESTION_NOT_AVAILABLE");
  if (existing) {
    const current = await expireIfDue(comp, existing, at);
    if (current.status !== "STARTED") throw new AppError(current.status === "SUBMITTED" ? "ANSWER_ALREADY_SUBMITTED" : "ATTEMPT_LOCKED");
    const sameSession = !!params.sessionId && String(current.sessionId) === String(params.sessionId);
    if (ac.lockOnLeave) {
      await lockAttempt(comp, current, sameSession ? "RELOADED" : "SECOND_DEVICE", at);
      throw new AppError("ATTEMPT_LOCKED", sameSession ? "The question page was reloaded, so today's attempt has ended." : "Today's question was opened on another device, so the attempt has ended.");
    }
    if (!sameSession) throw new AppError("ATTEMPT_OTHER_DEVICE");
    return startedPayload(question, comp, current);
  }

  const realOrder = question.options.map((o) => o.id);
  const deadline = Math.min(at.getTime() + ac.timeLimitSeconds * 1000, window.closesAt.getTime());
  try {
    const [created] = await QuizAttempt.create([
      {
        competitionId: comp._id,
        userId: params.userId,
        dayNumber,
        questionId: question._id,
        optionOrder: ac.shuffleOptions ? shuffled(realOrder) : realOrder,
        startedAt: at,
        deadlineAt: new Date(deadline),
        sessionId: params.sessionId,
        ip: params.meta?.ip ?? null,
        userAgent: params.meta?.userAgent ?? null,
      },
    ]);
    return startedPayload(question, comp, created!.toObject());
  } catch (e) {
    // Two Start clicks raced (e.g. two tabs): the loser is treated like a second Start.
    if (isDuplicateKeyError(e)) throw new AppError("ATTEMPT_OTHER_DEVICE");
    throw e;
  }
}

/** Records a client-side signal; leave events end the attempt when lockOnLeave is on. */
export async function recordAttemptEvent(params: { userId: Types.ObjectId; sessionId: Types.ObjectId | null; type: AttemptEventType; at?: Date }) {
  await connectDb();
  const at = params.at ?? now();
  const { comp, dayNumber } = await loadToday(params.userId, at);
  const ac = antiCheatOf(comp);
  const attempt = await QuizAttempt.findOneAndUpdate(
    { competitionId: comp._id, userId: params.userId, dayNumber, status: "STARTED", "events.49": { $exists: false } },
    { $push: { events: { type: params.type, at } } },
    { new: true },
  ).lean();
  if (!attempt) {
    const current = await QuizAttempt.findOne({ competitionId: comp._id, userId: params.userId, dayNumber }).select("status lockReason").lean();
    return { status: current?.status ?? null, lockReason: current?.lockReason ?? null };
  }
  const isLeave = (LEAVE_EVENTS as readonly string[]).includes(params.type);
  const counts = params.type !== "FULLSCREEN_EXIT" || ac.requireFullscreen;
  if (ac.enabled && ac.lockOnLeave && isLeave && counts) {
    const ended = await lockAttempt(comp, attempt, params.type === "FULLSCREEN_EXIT" ? "FULLSCREEN_EXIT" : "LEFT_PAGE", at);
    return { status: ended.status, lockReason: ended.lockReason };
  }
  return { status: attempt.status, lockReason: attempt.lockReason };
}

/**
 * Validates a submission in anti-cheat mode and maps display ids to real ids.
 * Must be called before writing the answer; `claim` marks the attempt SUBMITTED
 * inside the answer's transaction so a concurrent lock can't be overwritten.
 */
export async function prepareAttemptSubmission(params: {
  comp: ICompetition;
  userId: Types.ObjectId;
  dayNumber: number;
  sessionId: Types.ObjectId | null;
  displayIds: string[];
  at: Date;
}) {
  const found = await QuizAttempt.findOne({ competitionId: params.comp._id, userId: params.userId, dayNumber: params.dayNumber }).lean();
  if (!found) throw new AppError("ATTEMPT_REQUIRED");
  const attempt = await expireIfDue(params.comp, found, params.at);
  if (attempt.status === "SUBMITTED") throw new AppError("ANSWER_ALREADY_SUBMITTED");
  if (attempt.status === "EXPIRED") throw new AppError("QUESTION_EXPIRED", "Time is up — the answer wasn't submitted in time.");
  if (attempt.status === "LOCKED") throw new AppError("ATTEMPT_LOCKED");
  if (!params.sessionId || String(attempt.sessionId) !== String(params.sessionId)) {
    if (antiCheatOf(params.comp).lockOnLeave) await lockAttempt(params.comp, attempt, "SECOND_DEVICE", params.at);
    throw new AppError("ATTEMPT_OTHER_DEVICE");
  }
  const { toReal } = displayMapping(attempt.optionOrder);
  const realIds = params.displayIds.map((d) => toReal(d));
  if (realIds.some((r) => !r)) throw new AppError("INVALID_OPTION");
  return {
    attempt,
    realIds: realIds as OptionId[],
    /** Responds-time for tie-breakers: measured from Start, not from the day's opening. */
    responseTimeMs: Math.max(0, params.at.getTime() - attempt.startedAt.getTime()),
    async claim(session: ClientSession) {
      const res = await QuizAttempt.updateOne({ _id: attempt._id, status: "STARTED" }, { $set: { status: "SUBMITTED", endedAt: params.at } }, { session });
      if (res.modifiedCount !== 1) throw new AppError("ATTEMPT_LOCKED");
    },
  };
}

/** Today's attempt for the quiz page, after applying a lazy expiry. */
export async function currentAttempt(comp: ICompetition, userId: Types.ObjectId, dayNumber: number, at: Date) {
  const found = await QuizAttempt.findOne({ competitionId: comp._id, userId, dayNumber }).lean();
  return found ? expireIfDue(comp, found, at) : null;
}

