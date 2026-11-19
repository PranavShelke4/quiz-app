import type { ClientSession, Types } from "mongoose";
import { bankOrderFor, pickForParticipant } from "@/lib/quiz/pools";
import type { ICompetition } from "@/models/Competition";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question, type IQuestion } from "@/models/Question";
import { QuizAttempt } from "@/models/QuizAttempt";

type CompRef = Pick<ICompetition, "_id"> & Partial<Pick<ICompetition, "questionMode">>;

/** Published versions of a day's question, in variant order. */
export async function publishedVersions(competitionId: Types.ObjectId, dayNumber: number, session?: ClientSession): Promise<IQuestion[]> {
  return Question.find({ competitionId, dayNumber, status: "PUBLISHED" }).sort({ variant: 1, _id: 1 }).session(session ?? null).lean();
}

/**
 * RANDOM mode: every participant walks the whole published bank in their own fixed shuffled
 * order and gets the first question they haven't been shown on another day. Stable across
 * reloads (no storage needed), and no participant ever sees the same question twice.
 */
async function randomBankQuestion(competitionId: Types.ObjectId, dayNumber: number, userId: Types.ObjectId, session?: ClientSession) {
  const [bank, attempts, answers] = await Promise.all([
    Question.find({ competitionId, status: "PUBLISHED" }).session(session ?? null).lean(),
    QuizAttempt.find({ competitionId, userId, dayNumber: { $ne: dayNumber } }).select("questionId").session(session ?? null).lean(),
    DailyAnswer.find({ competitionId, userId, dayNumber: { $ne: dayNumber }, status: "ANSWERED" }).select("questionId").session(session ?? null).lean(),
  ]);
  if (!bank.length) return null;
  // "Seen" = shown in an attempt or answered; a MISSED record without an attempt was never shown.
  const seen = new Set([...attempts, ...answers].map((x) => String(x.questionId)));
  const order = bankOrderFor(bank, { competitionId: String(competitionId), userId: String(userId) });
  return order.find((q) => !seen.has(String(q._id))) ?? order[(dayNumber - 1) % order.length]!;
}

/** The question this participant gets for a day (null if there's nothing published). */
export async function questionForParticipant(comp: CompRef, dayNumber: number, userId: Types.ObjectId, session?: ClientSession) {
  if (comp.questionMode === "RANDOM") return randomBankQuestion(comp._id, dayNumber, userId, session);
  const versions = await publishedVersions(comp._id, dayNumber, session);
  return pickForParticipant(versions, { competitionId: String(comp._id), dayNumber, userId: String(userId) }) ?? null;
}
