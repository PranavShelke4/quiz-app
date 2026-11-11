import type { ClientSession, Types } from "mongoose";
import { pickForParticipant } from "@/lib/quiz/pools";
import { Question, type IQuestion } from "@/models/Question";

/** Published versions of a day's question, in variant order. */
export async function publishedVersions(competitionId: Types.ObjectId, dayNumber: number, session?: ClientSession): Promise<IQuestion[]> {
  return Question.find({ competitionId, dayNumber, status: "PUBLISHED" }).sort({ variant: 1, _id: 1 }).session(session ?? null).lean();
}

/** The version of the day's question this participant gets (null if the day has none published). */
export async function questionForParticipant(competitionId: Types.ObjectId, dayNumber: number, userId: Types.ObjectId, session?: ClientSession) {
  const versions = await publishedVersions(competitionId, dayNumber, session);
  return pickForParticipant(versions, { competitionId: String(competitionId), dayNumber, userId: String(userId) }) ?? null;
}
