import type { Types } from "mongoose";
import { getDayWindow } from "@/lib/competition/schedule";
import { connectDb, withTransaction } from "@/lib/db/mongoose";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { antiCheatOf, type AntiCheatSettings, type LockReason } from "@/lib/quiz/anticheat-config";
import { correctIdsOf, scoreAnswer, selectedIdsOf } from "@/lib/quiz/scoring";
import { computeStreaks } from "@/lib/quiz/streak";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import type { OptionId } from "@/lib/validation/quiz";
import type { ICompetition } from "@/models/Competition";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question, type IQuestion } from "@/models/Question";
import { QuizAttempt } from "@/models/QuizAttempt";
import { User } from "@/models/User";
import {
  clockFor,
  getCurrentCompetition,
  isLeaderboardRevealed,
  isRegistrationOpen,
  toPublicCompetition,
  type PublicCompetitionDTO,
} from "@/services/competition.service";
import { flagFastAnswer } from "@/services/anticheat.service";
import { questionForParticipant } from "@/services/pool.service";
import { currentAttempt, displayMapping, displayOptions, lockAttempt, prepareAttemptSubmission } from "@/services/attempt.service";
import { getParticipant, joinCompetition, recalculateParticipantStats, repairUserMissedDays } from "@/services/participant.service";

// ---------------------------------------------------------------------------
// DTOs. The user-facing question DTO has NO correctOptionId and NO explanation.
// Serializers whitelist fields; Mongo documents are never returned directly.
// ---------------------------------------------------------------------------
export interface UserQuestionDTO {
  id: string;
  dayNumber: number;
  questionText: string;
  options: { id: OptionId; text: string }[];
  /** True when more than one option is correct ("select all that apply"). Which ones stays secret. */
  multiSelect: boolean;
  points: number;
  category: string;
  difficulty: string;
}

export function toUserQuestion(q: IQuestion, comp: ICompetition): UserQuestionDTO {
  return {
    id: String(q._id),
    dayNumber: q.dayNumber,
    questionText: q.questionText,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
    multiSelect: correctIdsOf(q).length > 1,
    points: q.points ?? comp.scoring.pointsPerCorrectAnswer,
    category: q.category,
    difficulty: q.difficulty,
  };
}

export type DayState = "ANSWERED" | "MISSED" | "OPEN" | "UPCOMING";

/** Participation only — deliberately contains no score, correctness or rank. */
export interface ProgressDTO {
  days: { dayNumber: number; state: DayState }[];
  answered: number;
  missed: number;
  eligibleDays: number;
  currentStreak: number;
  longestStreak: number;
}

/** What a participant may know before pressing Start (no text, no options). */
export interface ReadyInfo {
  points: number;
  category: string;
  difficulty: string;
  multiSelect: boolean;
  optionCount: number;
}

export interface QuizStateDTO {
  competition: PublicCompetitionDTO | null;
  isParticipant: boolean;
  canJoin: boolean;
  today:
    | { status: "OPEN"; dayNumber: number; opensAt: string; closesAt: string; question: UserQuestionDTO }
    | { status: "ANSWERED"; dayNumber: number; opensAt: string; closesAt: string; submittedAt: string; selectedOptionId: OptionId; selectedOptionIds: OptionId[]; question: UserQuestionDTO }
    | { status: "UNAVAILABLE"; dayNumber: number; opensAt: string; closesAt: string }
    /** The question is live but the user hasn't joined — its text and options are withheld. */
    | { status: "LOCKED"; dayNumber: number; opensAt: string; closesAt: string }
    | { status: "UPCOMING"; dayNumber: number; opensAt: string; closesAt: string }
    | { status: "CLOSED"; dayNumber: number; opensAt: string; closesAt: string }
    /** Anti-cheat mode: question hidden until the participant presses Start. */
    | { status: "READY"; dayNumber: number; opensAt: string; closesAt: string; info: ReadyInfo; antiCheat: AntiCheatSettings }
    /** Anti-cheat mode, resumable attempts only (lockOnLeave off). Option ids are display ids. */
    | { status: "IN_PROGRESS"; dayNumber: number; opensAt: string; closesAt: string; question: UserQuestionDTO; startedAt: string; deadlineAt: string; antiCheat: AntiCheatSettings }
    /** Anti-cheat mode: today's attempt ended without an answer (recorded as missed). */
    | { status: "ENDED"; dayNumber: number; opensAt: string; closesAt: string; reason: LockReason | "TIME_UP" }
    | null;
  nextQuestionAt: string | null;
  progress: ProgressDTO | null;
}

async function loadProgress(comp: ICompetition, userId: Types.ObjectId, at: Date): Promise<ProgressDTO> {
  const clock = clockFor(comp, at);
  const answers = await DailyAnswer.find({ competitionId: comp._id, userId }).select("dayNumber status").lean();
  const byDay = new Map(answers.map((a) => [a.dayNumber, a.status]));
  const days = Array.from({ length: comp.durationDays }, (_, i) => {
    const dayNumber = i + 1;
    const recorded = byDay.get(dayNumber);
    let state: DayState;
    if (recorded) state = recorded;
    else if (clock.phase === "ACTIVE" && dayNumber === clock.currentDay) state = "OPEN";
    else if (dayNumber <= clock.lastClosedDay) state = "MISSED"; // closed, not yet materialised by rollover
    else state = "UPCOMING";
    return { dayNumber, state };
  });
  const answeredDays = days.filter((d) => d.state === "ANSWERED").map((d) => d.dayNumber);
  const streaks =
    clock.phase === "NOT_STARTED"
      ? { currentStreak: 0, longestStreak: 0 }
      : computeStreaks({
          answeredDays,
          currentDay: clock.phase === "ENDED" ? comp.durationDays : clock.currentDay!,
          todayOpen: clock.phase === "ACTIVE",
        });
  return {
    days,
    answered: answeredDays.length,
    missed: days.filter((d) => d.state === "MISSED").length,
    eligibleDays: clock.phase === "ACTIVE" ? clock.currentDay! : clock.phase === "ENDED" ? comp.durationDays : 0,
    ...streaks,
  };
}

export async function getQuizState(userId: Types.ObjectId, at: Date = now(), opts: { sessionId?: Types.ObjectId | null } = {}): Promise<QuizStateDTO> {
  await connectDb();
  const comp = await getCurrentCompetition(at);
  if (!comp) return { competition: null, isParticipant: false, canJoin: false, today: null, nextQuestionAt: null, progress: null };

  const clock = clockFor(comp, at);
  const participant = await getParticipant(comp._id, userId);
  if (participant) await repairUserMissedDays(comp, userId, at);

  const nowMs = at.getTime();
  const base = {
    competition: toPublicCompetition(comp, at),
    isParticipant: !!participant,
    canJoin: !participant && isRegistrationOpen(comp, at),
    progress: participant ? await loadProgress(comp, userId, at) : null,
  };

  // Only an ACTIVE competition has a "today"; before the start / after the end there is no day window.
  if (clock.phase !== "ACTIVE" || !clock.today || clock.currentDay === null) {
    return { ...base, nextQuestionAt: clock.phase === "NOT_STARTED" ? clock.startsAt.toISOString() : null, today: null };
  }

  const dayNumber = clock.currentDay;
  const todayWindow = clock.today;
  const opensAt = todayWindow.opensAt.toISOString();
  const closesAt = todayWindow.closesAt.toISOString();

  let nextQuestionAt: string | null = null;
  if (nowMs < todayWindow.opensAt.getTime()) {
    nextQuestionAt = opensAt;
  } else if (dayNumber < comp.durationDays) {
    nextQuestionAt = getDayWindow(comp, dayNumber + 1).opensAt.toISOString();
  }
  const active = { ...base, nextQuestionAt };

  if (nowMs < todayWindow.opensAt.getTime()) {
    return { ...active, today: { status: "UPCOMING", dayNumber, opensAt, closesAt } };
  }

  const answer = participant
    ? await DailyAnswer.findOne({ competitionId: comp._id, userId, dayNumber }).select("status selectedOptionId selectedOptionIds answeredAt questionId").lean()
    : null;

  if (nowMs >= todayWindow.closesAt.getTime() && (!answer || answer.status !== "ANSWERED")) {
    return { ...active, today: { status: "CLOSED", dayNumber, opensAt, closesAt } };
  }

  // Question pools: the question already answered/started wins; otherwise this participant's version.
  const pinnedId = answer?.questionId ?? (participant ? (await QuizAttempt.findOne({ competitionId: comp._id, userId, dayNumber }).select("questionId").lean())?.questionId : null);
  const question = pinnedId
    ? await Question.findById(pinnedId).lean()
    : await questionForParticipant(comp._id, dayNumber, userId);
  if (!question) return { ...active, today: { status: "UNAVAILABLE", dayNumber, opensAt, closesAt } };
  // Only participants ever receive the question text and options.
  if (!participant) return { ...active, today: { status: "LOCKED", dayNumber, opensAt, closesAt } };

  const ac = antiCheatOf(comp);
  const attempt = ac.enabled || answer ? await currentAttempt(comp, userId, dayNumber, at) : null;

  if (answer?.status === "ANSWERED" && answer.selectedOptionId && answer.answeredAt) {
    if (attempt) {
      // Show the question the way this participant saw it (their option order and letters).
      const { toDisplay } = displayMapping(attempt.optionOrder);
      const shown = selectedIdsOf(answer).map(toDisplay);
      return {
        ...active,
        today: {
          status: "ANSWERED",
          dayNumber,
          opensAt,
          closesAt,
          submittedAt: answer.answeredAt.toISOString(),
          selectedOptionId: shown[0]!,
          selectedOptionIds: shown,
          question: { ...toUserQuestion(question, comp), options: displayOptions(question, attempt.optionOrder) },
        },
      };
    }
    return {
      ...active,
      today: {
        status: "ANSWERED",
        dayNumber,
        opensAt,
        closesAt,
        submittedAt: answer.answeredAt.toISOString(),
        selectedOptionId: answer.selectedOptionId,
        selectedOptionIds: selectedIdsOf(answer) as OptionId[],
        question: toUserQuestion(question, comp),
      },
    };
  }
  if (attempt && attempt.status !== "STARTED" && attempt.status !== "SUBMITTED") {
    return { ...active, today: { status: "ENDED", dayNumber, opensAt, closesAt, reason: attempt.status === "EXPIRED" ? "TIME_UP" : (attempt.lockReason ?? "LEFT_PAGE") } };
  }
  if (answer?.status === "MISSED") return { ...active, today: { status: "CLOSED", dayNumber, opensAt, closesAt } };

  if (!ac.enabled) {
    return { ...active, today: { status: "OPEN", dayNumber, opensAt, closesAt, question: toUserQuestion(question, comp) } };
  }

  if (attempt?.status === "STARTED") {
    const sameSession = !!opts.sessionId && String(attempt.sessionId) === String(opts.sessionId);
    // Loading the page while an attempt runs = a reload, another tab or another device.
    if (ac.lockOnLeave) {
      const ended = await lockAttempt(comp, attempt, sameSession ? "RELOADED" : "SECOND_DEVICE", at);
      return { ...active, today: { status: "ENDED", dayNumber, opensAt, closesAt, reason: ended.lockReason ?? "RELOADED" } };
    }
    if (sameSession) {
      return {
        ...active,
        today: {
          status: "IN_PROGRESS",
          dayNumber,
          opensAt,
          closesAt,
          question: { ...toUserQuestion(question, comp), options: displayOptions(question, attempt.optionOrder) },
          startedAt: attempt.startedAt.toISOString(),
          deadlineAt: attempt.deadlineAt.toISOString(),
          antiCheat: ac,
        },
      };
    }
  }

  const info: ReadyInfo = {
    points: question.points ?? comp.scoring.pointsPerCorrectAnswer,
    category: question.category,
    difficulty: question.difficulty,
    multiSelect: correctIdsOf(question).length > 1,
    optionCount: question.options.length,
  };
  return { ...active, today: { status: "READY", dayNumber, opensAt, closesAt, info, antiCheat: ac } };
}

/**
 * Access to a specific day's question (e.g. GET /api/questions/:day).
 * Past days → QUESTION_EXPIRED, future days → QUESTION_NOT_AVAILABLE, today → question.
 */
export async function getQuestionForDay(userId: Types.ObjectId, dayParam: string, at: Date = now()): Promise<UserQuestionDTO> {
  await connectDb();
  const comp = await getCurrentCompetition(at);
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  if (!(await getParticipant(comp._id, userId))) throw new AppError("NOT_PARTICIPANT", "Join the competition to see its questions.");
  const clock = clockFor(comp, at);
  const day = /^\d{1,3}$/.test(dayParam) ? Number(dayParam) : NaN;
  if (clock.phase === "NOT_STARTED") throw new AppError("COMPETITION_NOT_STARTED");
  if (!Number.isInteger(day) || day < 1 || day > comp.durationDays) throw new AppError("QUESTION_NOT_AVAILABLE");
  if (clock.phase === "ENDED" || day < clock.currentDay!) {
    // After reveal, reviewing questions happens through /api/results (which includes answers).
    throw new AppError("QUESTION_EXPIRED", isLeaderboardRevealed(comp, at) ? "This question has closed. Review it on the results page." : undefined);
  }
  if (day > clock.currentDay!) throw new AppError("QUESTION_NOT_AVAILABLE");
  // Timed mode: the text is only released through POST /api/quiz/attempt/start.
  if (antiCheatOf(comp).enabled) throw new AppError("ATTEMPT_REQUIRED");
  const q = await questionForParticipant(comp._id, day, userId);
  if (!q) throw new AppError("QUESTION_NOT_AVAILABLE");
  return toUserQuestion(q, comp);
}

export interface SubmitResult {
  status: "ANSWERED";
  dayNumber: number;
  submittedAt: string;
  selectedOptionId: OptionId;
  selectedOptionIds: OptionId[];
}

/**
 * Records today's answer. Everything is derived server-side:
 *  - user identity from the session (caller passes the session user id)
 *  - competition + day from the server clock in the competition time zone
 *  - correctness and score from the stored question
 * The client may only choose an option (and optionally assert which day/question it saw).
 *
 * Duplicate protection is layered: pre-check in the transaction, then the unique
 * index (competitionId, userId, dayNumber) as the final arbiter for races.
 */
export async function submitAnswer(params: {
  userId: Types.ObjectId;
  /** Single-answer questions. */
  optionId?: OptionId;
  /** Multiple-answer questions. */
  optionIds?: OptionId[];
  expectedDayNumber?: number;
  expectedQuestionId?: string;
  sessionId?: Types.ObjectId | null;
  meta?: Pick<RequestMeta, "ip" | "userAgent">;
  at?: Date;
}): Promise<SubmitResult> {
  await connectDb();
  const at = params.at ?? now();
  const comp = await getCurrentCompetition(at);
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");

  const clock = clockFor(comp, at);
  if (clock.phase === "NOT_STARTED") throw new AppError("COMPETITION_NOT_STARTED");
  if (clock.phase === "ENDED") throw new AppError("COMPETITION_ENDED");
  const dayNumber = clock.currentDay!;

  if (params.expectedDayNumber !== undefined) {
    if (params.expectedDayNumber < dayNumber) throw new AppError("QUESTION_EXPIRED");
    if (params.expectedDayNumber > dayNumber) throw new AppError("QUESTION_NOT_AVAILABLE");
  }

  const user = await User.findById(params.userId).select("isActive").lean();
  if (!user || !user.isActive) throw new AppError("USER_DISABLED");
  if (!(await getParticipant(comp._id, params.userId))) throw new AppError("NOT_PARTICIPANT", "Join the competition before answering.");

  let picked: string[] = [...new Set(params.optionIds?.length ? params.optionIds : params.optionId ? [params.optionId] : [])];
  // Timed mode: the client sent display letters; map them to the real ids via the attempt.
  const ac = antiCheatOf(comp);
  const timed = ac.enabled
    ? await prepareAttemptSubmission({ comp, userId: params.userId, dayNumber, sessionId: params.sessionId ?? null, displayIds: picked, at })
    : null;
  if (timed) picked = timed.realIds;

  // The question this participant was shown: the attempt's in timed mode, else their pool version.
  const question = timed ? await Question.findById(timed.attempt.questionId).lean() : await questionForParticipant(comp._id, dayNumber, params.userId);
  if (!question || question.status !== "PUBLISHED") throw new AppError("QUESTION_NOT_AVAILABLE");
  if (params.expectedQuestionId && params.expectedQuestionId !== String(question._id)) throw new AppError("QUESTION_EXPIRED");
  const multiSelect = correctIdsOf(question).length > 1;
  // Store in option order so "C,A" and "A,C" are the same answer.
  const selectedIds = question.options.map((o) => o.id).filter((id) => picked.includes(id));
  if (!picked.length || selectedIds.length !== picked.length) throw new AppError("INVALID_OPTION");
  if (!multiSelect && selectedIds.length > 1) throw new AppError("INVALID_OPTION", "Choose exactly one option.");

  const window = getDayWindow(comp, dayNumber);
  if (at.getTime() < window.opensAt.getTime()) {
    throw new AppError("QUESTION_NOT_AVAILABLE", "Today's question opens at 9:00 AM.");
  }
  if (at.getTime() >= window.closesAt.getTime()) {
    throw new AppError("QUESTION_EXPIRED", "Today's question closed at 6:00 PM.");
  }

  const { isCorrect, score } = scoreAnswer({
    selectedOptionIds: selectedIds,
    correctOptionIds: correctIdsOf(question),
    questionPoints: question.points,
    config: comp.scoring,
  });

  try {
    await withTransaction(async (session) => {
      // Re-check the window at write time (the request may have waited on the transaction).
      if (now().getTime() < window.opensAt.getTime()) throw new AppError("QUESTION_NOT_AVAILABLE");
      if (now().getTime() >= window.closesAt.getTime()) throw new AppError("QUESTION_EXPIRED");

      const existing = await DailyAnswer.findOne({ competitionId: comp._id, userId: params.userId, dayNumber })
        .select("status")
        .session(session)
        .lean();
      if (existing) throw new AppError(existing.status === "MISSED" ? "QUESTION_EXPIRED" : "ANSWER_ALREADY_SUBMITTED");
      // Marks the attempt SUBMITTED in this transaction; fails if it was locked meanwhile.
      if (timed) await timed.claim(session);

      await DailyAnswer.create(
        [
          {
            competitionId: comp._id,
            userId: params.userId,
            dayNumber,
            questionId: question._id,
            selectedOptionId: selectedIds[0],
            selectedOptionIds: selectedIds,
            isCorrect,
            score,
            status: "ANSWERED",
            answeredAt: at,
            responseTimeMs: timed ? timed.responseTimeMs : Math.max(0, at.getTime() - window.opensAt.getTime()),
            ip: params.meta?.ip ?? null,
            userAgent: params.meta?.userAgent ?? null,
            sessionId: params.sessionId ?? null,
          },
        ],
        { session },
      );
      await recalculateParticipantStats(comp, params.userId, { session, at });
    });
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError("ANSWER_ALREADY_SUBMITTED");
    // Transaction write conflicts on the same (user, day) mean a concurrent submission won.
    if ((e as { codeName?: string }).codeName === "WriteConflict") throw new AppError("ANSWER_ALREADY_SUBMITTED");
    throw e;
  }

  // Note: the response is identical for correct and incorrect answers.
  if (timed && ac.flagFastAnswers) {
    // Best effort: a failure to flag must never fail a recorded answer.
    await flagFastAnswer({ competitionId: comp._id, userId: params.userId, dayNumber, question, responseMs: timed.responseTimeMs, isCorrect }).catch(() => 0);
  }

  // Echo the letters the participant saw (display ids in timed mode).
  const echoed = timed ? selectedIds.map(displayMapping(timed.attempt.optionOrder).toDisplay) : selectedIds;
  return { status: "ANSWERED", dayNumber, submittedAt: at.toISOString(), selectedOptionId: echoed[0]!, selectedOptionIds: echoed };
}

export async function joinCurrentCompetition(userId: Types.ObjectId, at: Date = now()) {
  await connectDb();
  const comp = await getCurrentCompetition(at);
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  const user = await User.findById(userId).select("isActive").lean();
  if (!user?.isActive) throw new AppError("USER_DISABLED");
  await withTransaction((session) => joinCompetition(comp, userId, { session, at }));
  return { joined: true, competitionId: String(comp._id) };
}

export async function getProgress(userId: Types.ObjectId, at: Date = now()) {
  const state = await getQuizState(userId, at);
  return { competition: state.competition, isParticipant: state.isParticipant, progress: state.progress };
}
