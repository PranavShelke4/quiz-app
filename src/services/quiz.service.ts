import type { Types } from "mongoose";
import { getDayWindow } from "@/lib/competition/schedule";
import { connectDb, withTransaction } from "@/lib/db/mongoose";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { scoreAnswer } from "@/lib/quiz/scoring";
import { computeStreaks } from "@/lib/quiz/streak";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import type { OptionId } from "@/lib/validation/quiz";
import type { ICompetition } from "@/models/Competition";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question, type IQuestion } from "@/models/Question";
import { User } from "@/models/User";
import {
  clockFor,
  getCurrentCompetition,
  isLeaderboardRevealed,
  isRegistrationOpen,
  toPublicCompetition,
  type PublicCompetitionDTO,
} from "@/services/competition.service";
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

export interface QuizStateDTO {
  competition: PublicCompetitionDTO | null;
  isParticipant: boolean;
  canJoin: boolean;
  today:
    | { status: "OPEN"; dayNumber: number; opensAt: string; closesAt: string; question: UserQuestionDTO }
    | { status: "ANSWERED"; dayNumber: number; opensAt: string; closesAt: string; submittedAt: string; selectedOptionId: OptionId; question: UserQuestionDTO }
    | { status: "UNAVAILABLE"; dayNumber: number; opensAt: string; closesAt: string }
    | { status: "UPCOMING"; dayNumber: number; opensAt: string; closesAt: string }
    | { status: "CLOSED"; dayNumber: number; opensAt: string; closesAt: string }
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

export async function getQuizState(userId: Types.ObjectId, at: Date = now()): Promise<QuizStateDTO> {
  await connectDb();
  const comp = await getCurrentCompetition(at);
  if (!comp) return { competition: null, isParticipant: false, canJoin: false, today: null, nextQuestionAt: null, progress: null };

  const clock = clockFor(comp, at);
  const participant = await getParticipant(comp._id, userId);
  if (participant) await repairUserMissedDays(comp, userId, at);

  const dayNumber = clock.currentDay!;
  const todayWindow = clock.today!;
  const opensAt = todayWindow.opensAt.toISOString();
  const closesAt = todayWindow.closesAt.toISOString();
  const nowMs = at.getTime();

  let nextQuestionAt: string | null = null;
  if (clock.phase === "NOT_STARTED") {
    nextQuestionAt = clock.startsAt.toISOString();
  } else if (clock.phase === "ACTIVE") {
    if (nowMs < todayWindow.opensAt.getTime()) {
      nextQuestionAt = todayWindow.opensAt.toISOString();
    } else if (dayNumber < comp.durationDays) {
      const nextWindow = getDayWindow(comp, dayNumber + 1);
      nextQuestionAt = nextWindow.opensAt.toISOString();
    }
  }

  const base = {
    competition: toPublicCompetition(comp, at),
    isParticipant: !!participant,
    canJoin: !participant && isRegistrationOpen(comp, at),
    progress: participant ? await loadProgress(comp, userId, at) : null,
    nextQuestionAt,
  };

  if (clock.phase !== "ACTIVE") return { ...base, today: null };

  if (nowMs < todayWindow.opensAt.getTime()) {
    return { ...base, today: { status: "UPCOMING", dayNumber, opensAt, closesAt } };
  }

  const answer = participant
    ? await DailyAnswer.findOne({ competitionId: comp._id, userId, dayNumber }).select("status selectedOptionId answeredAt").lean()
    : null;

  if (nowMs >= todayWindow.closesAt.getTime() && (!answer || answer.status !== "ANSWERED")) {
    return { ...base, today: { status: "CLOSED", dayNumber, opensAt, closesAt } };
  }

  const question = await Question.findOne({ competitionId: comp._id, dayNumber, status: "PUBLISHED" }).lean();
  if (!question) return { ...base, today: { status: "UNAVAILABLE", dayNumber, opensAt, closesAt } };

  if (answer?.status === "ANSWERED" && answer.selectedOptionId && answer.answeredAt) {
    return {
      ...base,
      today: {
        status: "ANSWERED",
        dayNumber,
        opensAt,
        closesAt,
        submittedAt: answer.answeredAt.toISOString(),
        selectedOptionId: answer.selectedOptionId,
        question: toUserQuestion(question, comp),
      },
    };
  }
  return { ...base, today: { status: "OPEN", dayNumber, opensAt, closesAt, question: toUserQuestion(question, comp) } };
}

/**
 * Access to a specific day's question (e.g. GET /api/questions/:day).
 * Past days → QUESTION_EXPIRED, future days → QUESTION_NOT_AVAILABLE, today → question.
 */
export async function getQuestionForDay(dayParam: string, at: Date = now()): Promise<UserQuestionDTO> {
  await connectDb();
  const comp = await getCurrentCompetition(at);
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  const clock = clockFor(comp, at);
  const day = /^\d{1,3}$/.test(dayParam) ? Number(dayParam) : NaN;
  if (clock.phase === "NOT_STARTED") throw new AppError("COMPETITION_NOT_STARTED");
  if (!Number.isInteger(day) || day < 1 || day > comp.durationDays) throw new AppError("QUESTION_NOT_AVAILABLE");
  if (clock.phase === "ENDED" || day < clock.currentDay!) {
    // After reveal, reviewing questions happens through /api/results (which includes answers).
    throw new AppError("QUESTION_EXPIRED", isLeaderboardRevealed(comp, at) ? "This question has closed. Review it on the results page." : undefined);
  }
  if (day > clock.currentDay!) throw new AppError("QUESTION_NOT_AVAILABLE");
  const q = await Question.findOne({ competitionId: comp._id, dayNumber: day, status: "PUBLISHED" }).lean();
  if (!q) throw new AppError("QUESTION_NOT_AVAILABLE");
  return toUserQuestion(q, comp);
}

export interface SubmitResult {
  status: "ANSWERED";
  dayNumber: number;
  submittedAt: string;
  selectedOptionId: OptionId;
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
  optionId: OptionId;
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

  const question = await Question.findOne({ competitionId: comp._id, dayNumber, status: "PUBLISHED" }).lean();
  if (!question) throw new AppError("QUESTION_NOT_AVAILABLE");
  if (params.expectedQuestionId && params.expectedQuestionId !== String(question._id)) throw new AppError("QUESTION_EXPIRED");
  if (!question.options.some((o) => o.id === params.optionId)) throw new AppError("INVALID_OPTION");

  const window = getDayWindow(comp, dayNumber);
  if (at.getTime() < window.opensAt.getTime()) {
    throw new AppError("QUESTION_NOT_AVAILABLE", "Today's question opens at 9:00 AM.");
  }
  if (at.getTime() >= window.closesAt.getTime()) {
    throw new AppError("QUESTION_EXPIRED", "Today's question closed at 6:00 PM.");
  }

  const { isCorrect, score } = scoreAnswer({
    selectedOptionId: params.optionId,
    correctOptionId: question.correctOptionId,
    questionPoints: question.points,
    config: comp.scoring,
  });

  try {
    await withTransaction(async (session) => {
      // Re-check the window at write time (the request may have waited on the transaction).
      if (now().getTime() < window.opensAt.getTime()) throw new AppError("QUESTION_NOT_AVAILABLE");
      if (now().getTime() >= window.closesAt.getTime()) throw new AppError("QUESTION_EXPIRED");

      await joinCompetition(comp, params.userId, { session, at });

      const existing = await DailyAnswer.findOne({ competitionId: comp._id, userId: params.userId, dayNumber })
        .select("status")
        .session(session)
        .lean();
      if (existing) throw new AppError(existing.status === "MISSED" ? "QUESTION_EXPIRED" : "ANSWER_ALREADY_SUBMITTED");

      await DailyAnswer.create(
        [
          {
            competitionId: comp._id,
            userId: params.userId,
            dayNumber,
            questionId: question._id,
            selectedOptionId: params.optionId,
            isCorrect,
            score,
            status: "ANSWERED",
            answeredAt: at,
            responseTimeMs: Math.max(0, at.getTime() - window.opensAt.getTime()),
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
  return { status: "ANSWERED", dayNumber, submittedAt: at.toISOString(), selectedOptionId: params.optionId };
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
