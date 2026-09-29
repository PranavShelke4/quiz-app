import { Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { escapeRegex } from "@/lib/validation/common";
import { DailyAnswer, type IDailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { User } from "@/models/User";
import { Competition } from "@/models/Competition";

export interface AnswerFilters {
  competitionId?: string;
  day?: number;
  user?: string; // search by name/email
  status?: "ANSWERED" | "MISSED";
  correctness?: "correct" | "incorrect";
  from?: string;
  to?: string;
}

export async function buildAnswerFilter(f: AnswerFilters) {
  const filter: Record<string, unknown> = {};
  if (f.competitionId && Types.ObjectId.isValid(f.competitionId)) filter.competitionId = new Types.ObjectId(f.competitionId);
  if (f.day) filter.dayNumber = f.day;
  if (f.status) filter.status = f.status;
  if (f.correctness === "correct") filter.isCorrect = true;
  if (f.correctness === "incorrect") filter.isCorrect = false;
  const range: Record<string, Date> = {};
  if (f.from && !Number.isNaN(Date.parse(f.from))) range.$gte = new Date(f.from);
  if (f.to && !Number.isNaN(Date.parse(f.to))) range.$lte = new Date(`${f.to}T23:59:59.999Z`);
  if (Object.keys(range).length) filter.createdAt = range;
  if (f.user) {
    const re = { $regex: escapeRegex(f.user), $options: "i" };
    const users = await User.find({ $or: [{ name: re }, { email: re }] }).select("_id").limit(500).lean();
    filter.userId = { $in: users.map((u) => u._id) };
  }
  return filter;
}

async function hydrate(answers: IDailyAnswer[]) {
  const [users, questions, comps] = await Promise.all([
    User.find({ _id: { $in: answers.map((a) => a.userId) } }).select("name email").lean(),
    Question.find({ _id: { $in: answers.map((a) => a.questionId).filter(Boolean) } }).select("questionText options correctOptionId").lean(),
    Competition.find({ _id: { $in: [...new Set(answers.map((a) => String(a.competitionId)))] } }).select("name").lean(),
  ]);
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const qMap = new Map(questions.map((q) => [String(q._id), q]));
  const cMap = new Map(comps.map((c) => [String(c._id), c]));
  return answers.map((a) => {
    const q = a.questionId ? qMap.get(String(a.questionId)) : undefined;
    const optionText = (id: string | null | undefined) => (id ? `${id}. ${q?.options.find((o) => o.id === id)?.text ?? ""}` : "");
    return {
      id: String(a._id),
      userId: String(a.userId),
      userName: uMap.get(String(a.userId))?.name ?? "Deleted user",
      userEmail: uMap.get(String(a.userId))?.email ?? "",
      competition: cMap.get(String(a.competitionId))?.name ?? "",
      dayNumber: a.dayNumber,
      question: q?.questionText ?? "",
      selectedAnswer: optionText(a.selectedOptionId),
      correctAnswer: optionText(q?.correctOptionId),
      isCorrect: a.isCorrect,
      score: a.score,
      status: a.status,
      answeredAt: a.answeredAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      ip: a.ip,
      corrected: !!a.correctedAt,
    };
  });
}

export async function listAnswers(filters: AnswerFilters, page: number, pageSize: number) {
  await connectDb();
  const filter = await buildAnswerFilter(filters);
  const [items, total] = await Promise.all([
    DailyAnswer.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    DailyAnswer.countDocuments(filter),
  ]);
  return { items: await hydrate(items), total };
}

/** Streams hydrated rows in batches for CSV export (keeps memory bounded). */
export async function* iterateAnswers(filters: AnswerFilters, batchSize = 500) {
  await connectDb();
  const filter = await buildAnswerFilter(filters);
  const cursor = DailyAnswer.find(filter).sort({ competitionId: 1, dayNumber: 1, _id: 1 }).lean().cursor({ batchSize });
  let batch: IDailyAnswer[] = [];
  for await (const doc of cursor) {
    batch.push(doc as IDailyAnswer);
    if (batch.length >= batchSize) {
      yield await hydrate(batch);
      batch = [];
    }
  }
  if (batch.length) yield await hydrate(batch);
}
