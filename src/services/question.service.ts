import { Types } from "mongoose";
import { z } from "zod";
import { getDayAccess, getDayWindow } from "@/lib/competition/schedule";
import { parseCsvWithHeader } from "@/lib/csv";
import { connectDb, withTransaction } from "@/lib/db/mongoose";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { scoreAnswer } from "@/lib/quiz/scoring";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { escapeRegex } from "@/lib/validation/common";
import {
  CSV_IMPORT_HEADERS,
  OPTION_IDS,
  csvQuestionRowSchema,
  type OptionId,
  type QuestionInput,
} from "@/lib/validation/quiz";
import { AnswerCorrection } from "@/models/AnswerCorrection";
import type { ICompetition } from "@/models/Competition";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question, type IQuestion } from "@/models/Question";
import { recordAudit } from "@/services/audit.service";
import { clockFor, getCompetitionById } from "@/services/competition.service";
import { finalizeCompetition } from "@/services/leaderboard.service";
import { recalculateParticipantStats, runWithConcurrency } from "@/services/participant.service";

type Actor = { userId: Types.ObjectId; meta: Pick<RequestMeta, "ip" | "userAgent"> };

/** Admin DTO — includes the answer key. Only ever sent to admin endpoints. */
export function toAdminQuestion(q: IQuestion) {
  return {
    id: String(q._id),
    competitionId: String(q.competitionId),
    dayNumber: q.dayNumber,
    questionText: q.questionText,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
    correctOptionId: q.correctOptionId,
    explanation: q.explanation,
    category: q.category,
    difficulty: q.difficulty,
    points: q.points,
    status: q.status,
    scheduledDate: q.scheduledDate.toISOString(),
    updatedAt: q.updatedAt?.toISOString() ?? null,
  };
}
export type AdminQuestionDTO = ReturnType<typeof toAdminQuestion>;

/**
 * A question is locked once its day has opened (participants may have seen it)
 * or the competition is no longer a draft/scheduled one. Locked questions can only
 * change through the audited correction workflow.
 */
export function isQuestionLocked(comp: ICompetition, dayNumber: number, at: Date = now()): boolean {
  if (comp.status === "COMPLETED" || comp.status === "ARCHIVED") return true;
  if (dayNumber > comp.durationDays) return false;
  return getDayAccess(comp, dayNumber, at) !== "UPCOMING";
}

function assertDayInRange(comp: ICompetition, dayNumber: number) {
  if (dayNumber < 1 || dayNumber > comp.durationDays) {
    throw new AppError("VALIDATION_ERROR", `Day must be between 1 and ${comp.durationDays}.`, { fields: { dayNumber: ["Out of range"] } });
  }
}

export async function listQuestions(params: {
  competitionId: string;
  search?: string;
  status?: "DRAFT" | "PUBLISHED";
  category?: string;
  difficulty?: string;
}) {
  await connectDb();
  const comp = await getCompetitionById(params.competitionId);
  const filter: Record<string, unknown> = { competitionId: comp._id };
  if (params.status) filter.status = params.status;
  if (params.category) filter.category = params.category;
  if (params.difficulty) filter.difficulty = params.difficulty;
  if (params.search) filter.questionText = { $regex: escapeRegex(params.search), $options: "i" };
  const questions = await Question.find(filter).sort({ dayNumber: 1 }).lean();
  const categories = await Question.distinct("category", { competitionId: comp._id });
  return { competition: comp, questions, categories: categories.sort() };
}

export async function getQuestion(id: string) {
  await connectDb();
  const q = await Question.findById(id).lean();
  if (!q) throw new AppError("QUESTION_NOT_FOUND");
  return q;
}

export async function createQuestion(input: QuestionInput & { status: "DRAFT" | "PUBLISHED" }, actor: Actor) {
  await connectDb();
  const comp = await getCompetitionById(input.competitionId);
  if (comp.status === "ARCHIVED" || comp.status === "COMPLETED") throw new AppError("COMPETITION_LOCKED");
  assertDayInRange(comp, input.dayNumber);
  if (isQuestionLocked(comp, input.dayNumber)) throw new AppError("QUESTION_LOCKED", "That day has already opened.");
  try {
    const [q] = await Question.create([
      {
        ...input,
        competitionId: comp._id,
        scheduledDate: getDayWindow(comp, input.dayNumber).opensAt,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      },
    ]);
    await recordAudit({ adminId: actor.userId, action: "QUESTION_CREATED", targetType: "Question", targetId: q._id, metadata: { competitionId: String(comp._id), dayNumber: q.dayNumber }, meta: actor.meta });
    return q.toObject();
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError("CONFLICT", `Day ${input.dayNumber} already has a question.`);
    throw e;
  }
}

export async function updateQuestion(id: string, input: Partial<Omit<QuestionInput, "competitionId">>, actor: Actor) {
  await connectDb();
  const q = await getQuestion(id);
  const comp = await getCompetitionById(q.competitionId);
  if (isQuestionLocked(comp, q.dayNumber)) throw new AppError("QUESTION_LOCKED");
  if (input.dayNumber !== undefined && input.dayNumber !== q.dayNumber) {
    assertDayInRange(comp, input.dayNumber);
    if (isQuestionLocked(comp, input.dayNumber)) throw new AppError("QUESTION_LOCKED", "The target day has already opened.");
  }
  const options = input.options ?? q.options;
  const correct = input.correctOptionId ?? q.correctOptionId;
  if (!options.some((o) => o.id === correct)) throw new AppError("VALIDATION_ERROR", "Correct option must match one of the options.");

  const $set: Record<string, unknown> = { ...input, updatedBy: actor.userId };
  if (input.dayNumber !== undefined) $set.scheduledDate = getDayWindow(comp, input.dayNumber).opensAt;
  try {
    await Question.updateOne({ _id: q._id }, { $set }, { runValidators: true });
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError("CONFLICT", `Day ${input.dayNumber} already has a question.`);
    throw e;
  }
  await recordAudit({ adminId: actor.userId, action: "QUESTION_UPDATED", targetType: "Question", targetId: q._id, metadata: { changed: Object.keys(input) }, meta: actor.meta });
  return getQuestion(id);
}

export async function deleteQuestion(id: string, actor: Actor) {
  await connectDb();
  const q = await getQuestion(id);
  const comp = await getCompetitionById(q.competitionId);
  if (isQuestionLocked(comp, q.dayNumber)) throw new AppError("QUESTION_LOCKED");
  if (comp.status !== "DRAFT") {
    throw new AppError("COMPETITION_LOCKED", "Unpublish the competition before deleting questions — every day of a published competition needs a question.");
  }
  if (await DailyAnswer.exists({ questionId: q._id })) throw new AppError("QUESTION_LOCKED", "This question has answers.");
  await Question.deleteOne({ _id: q._id });
  await recordAudit({ adminId: actor.userId, action: "QUESTION_DELETED", targetType: "Question", targetId: q._id, metadata: { dayNumber: q.dayNumber, questionText: q.questionText.slice(0, 120) }, meta: actor.meta });
}

export async function setQuestionStatus(id: string, status: "DRAFT" | "PUBLISHED", actor: Actor) {
  await connectDb();
  const q = await getQuestion(id);
  const comp = await getCompetitionById(q.competitionId);
  if (isQuestionLocked(comp, q.dayNumber)) throw new AppError("QUESTION_LOCKED");
  if (status === "DRAFT" && comp.status !== "DRAFT") {
    throw new AppError("COMPETITION_LOCKED", "Questions of a published competition can't be unpublished. Unpublish the competition first.");
  }
  await Question.updateOne({ _id: q._id }, { $set: { status, updatedBy: actor.userId } });
  await recordAudit({ adminId: actor.userId, action: status === "PUBLISHED" ? "QUESTION_PUBLISHED" : "QUESTION_UNPUBLISHED", targetType: "Question", targetId: q._id, meta: actor.meta });
  return getQuestion(id);
}

export async function publishAllDraftQuestions(competitionId: string, actor: Actor) {
  await connectDb();
  const comp = await getCompetitionById(competitionId);
  const drafts = await Question.find({ competitionId: comp._id, status: "DRAFT" }).select("dayNumber").lean();
  const eligible = drafts.filter((d) => !isQuestionLocked(comp, d.dayNumber)).map((d) => d._id);
  await Question.updateMany({ _id: { $in: eligible } }, { $set: { status: "PUBLISHED", updatedBy: actor.userId } });
  await recordAudit({ adminId: actor.userId, action: "QUESTION_PUBLISHED", targetType: "Competition", targetId: comp._id, metadata: { count: eligible.length, bulk: true }, meta: actor.meta });
  return { published: eligible.length };
}

/** Copies a question to another day (and optionally another competition) as a DRAFT. */
export async function duplicateQuestion(id: string, target: { competitionId?: string; dayNumber: number }, actor: Actor) {
  const q = await getQuestion(id);
  return createQuestion(
    {
      competitionId: target.competitionId ?? String(q.competitionId),
      dayNumber: target.dayNumber,
      questionText: q.questionText,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
      correctOptionId: q.correctOptionId,
      explanation: q.explanation,
      category: q.category,
      difficulty: q.difficulty,
      points: q.points,
      status: "DRAFT",
    },
    actor,
  );
}

/** Swaps the days of two questions atomically (upcoming days only). */
export async function swapQuestionDays(firstId: string, secondId: string, actor: Actor) {
  await connectDb();
  const [a, b] = await Promise.all([getQuestion(firstId), getQuestion(secondId)]);
  if (String(a.competitionId) !== String(b.competitionId)) throw new AppError("VALIDATION_ERROR", "Questions belong to different competitions.");
  const comp = await getCompetitionById(a.competitionId);
  if (isQuestionLocked(comp, a.dayNumber) || isQuestionLocked(comp, b.dayNumber)) throw new AppError("QUESTION_LOCKED");
  await withTransaction(async (session) => {
    // Park `a` on a temporary negative day to keep the unique index satisfied mid-swap.
    await Question.updateOne({ _id: a._id }, { $set: { dayNumber: -a.dayNumber } }, { session });
    await Question.updateOne({ _id: b._id }, { $set: { dayNumber: a.dayNumber, scheduledDate: getDayWindow(comp, a.dayNumber).opensAt } }, { session });
    await Question.updateOne({ _id: a._id }, { $set: { dayNumber: b.dayNumber, scheduledDate: getDayWindow(comp, b.dayNumber).opensAt } }, { session });
  });
  await recordAudit({ adminId: actor.userId, action: "QUESTIONS_REORDERED", targetType: "Competition", targetId: comp._id, metadata: { swapped: [a.dayNumber, b.dayNumber] }, meta: actor.meta });
}

// ---------------------------------------------------------------------------
// CSV import: validate the whole file first; import all-or-nothing by default.
// ---------------------------------------------------------------------------
export interface ImportRowError {
  row: number; // 1-based data row (header is row 0)
  dayNumber: string;
  errors: string[];
}

export interface ImportReport {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
  imported: number;
  dryRun: boolean;
}

export async function importQuestionsCsv(params: {
  competitionId: string;
  csv: string;
  dryRun: boolean;
  skipInvalid: boolean;
  publish: boolean;
  overwrite: boolean;
  actor: Actor;
}): Promise<ImportReport> {
  await connectDb();
  const comp = await getCompetitionById(params.competitionId);
  if (comp.status === "COMPLETED" || comp.status === "ARCHIVED") throw new AppError("COMPETITION_LOCKED");

  let parsed;
  try {
    parsed = parseCsvWithHeader(params.csv);
  } catch (e) {
    throw new AppError("VALIDATION_ERROR", `Couldn't read the CSV: ${(e as Error).message}`);
  }
  const missingHeaders = CSV_IMPORT_HEADERS.filter((h) => !["category", "difficulty", "points"].includes(h) && !parsed.headers.includes(h));
  if (missingHeaders.length) {
    throw new AppError("VALIDATION_ERROR", `Missing required column(s): ${missingHeaders.join(", ")}`);
  }
  if (parsed.records.length === 0) throw new AppError("VALIDATION_ERROR", "The file has no data rows.");
  if (parsed.records.length > 500) throw new AppError("VALIDATION_ERROR", "Import at most 500 rows at a time.");

  const existing = await Question.find({ competitionId: comp._id }).select("dayNumber").lean();
  const existingDays = new Set(existing.map((q) => q.dayNumber));
  const seenDays = new Map<number, number>();
  const errors: ImportRowError[] = [];
  const valid: { row: number; data: z.infer<typeof csvQuestionRowSchema> }[] = [];

  parsed.records.forEach((record, index) => {
    const row = index + 1;
    const result = csvQuestionRowSchema.safeParse(record);
    const rowErrors: string[] = [];
    if (!result.success) {
      rowErrors.push(...result.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`));
    } else {
      const d = result.data;
      if (d.dayNumber > comp.durationDays) rowErrors.push(`dayNumber: must be between 1 and ${comp.durationDays}`);
      const dupRow = seenDays.get(d.dayNumber);
      if (dupRow) rowErrors.push(`dayNumber: day ${d.dayNumber} also appears in row ${dupRow}`);
      if (existingDays.has(d.dayNumber) && !params.overwrite) rowErrors.push(`dayNumber: day ${d.dayNumber} already has a question`);
      if (d.dayNumber <= comp.durationDays && isQuestionLocked(comp, d.dayNumber)) rowErrors.push(`dayNumber: day ${d.dayNumber} has already opened`);
      const texts = [d.optionA, d.optionB, d.optionC, d.optionD].map((t) => t.toLowerCase());
      if (new Set(texts).size !== 4) rowErrors.push("options: all four options must be different");
      seenDays.set(d.dayNumber, row);
      if (!rowErrors.length) valid.push({ row, data: d });
    }
    if (rowErrors.length) errors.push({ row, dayNumber: record.dayNumber ?? "", errors: rowErrors });
  });

  const report: ImportReport = {
    totalRows: parsed.records.length,
    validRows: valid.length,
    errorRows: errors.length,
    errors,
    imported: 0,
    dryRun: params.dryRun,
  };
  if (params.dryRun) return report;
  if (errors.length && !params.skipInvalid) throw new AppError("IMPORT_INVALID", undefined, report);
  if (!valid.length) return report;

  await withTransaction(async (session) => {
    for (const { data } of valid) {
      const doc = {
        competitionId: comp._id,
        dayNumber: data.dayNumber,
        questionText: data.question,
        options: [
          { id: "A", text: data.optionA },
          { id: "B", text: data.optionB },
          { id: "C", text: data.optionC },
          { id: "D", text: data.optionD },
        ],
        correctOptionId: data.correctOption,
        explanation: data.explanation,
        category: data.category,
        difficulty: data.difficulty,
        points: data.points,
        status: params.publish ? "PUBLISHED" : "DRAFT",
        scheduledDate: getDayWindow(comp, data.dayNumber).opensAt,
        updatedBy: params.actor.userId,
      };
      await Question.findOneAndUpdate(
        { competitionId: comp._id, dayNumber: data.dayNumber },
        { $set: doc, $setOnInsert: { createdBy: params.actor.userId } },
        { upsert: true, session, runValidators: true },
      );
    }
  });
  report.imported = valid.length;
  await recordAudit({
    adminId: params.actor.userId,
    action: "QUESTIONS_IMPORTED",
    targetType: "Competition",
    targetId: comp._id,
    metadata: { imported: valid.length, skipped: errors.length, publish: params.publish, overwrite: params.overwrite },
    meta: params.actor.meta,
  });
  return report;
}

// ---------------------------------------------------------------------------
// Corrections — the only way to change scoring of a question that has opened.
// ---------------------------------------------------------------------------
export async function issueCorrection(
  questionId: string,
  input: { newCorrectOptionId?: OptionId; newPoints?: number | null; reason: string },
  actor: Actor,
) {
  await connectDb();
  const q = await getQuestion(questionId);
  const comp = await getCompetitionById(q.competitionId);
  if (!isQuestionLocked(comp, q.dayNumber)) {
    throw new AppError("CONFLICT", "This question hasn't opened yet — edit it directly instead of issuing a correction.");
  }
  const newCorrect = input.newCorrectOptionId ?? q.correctOptionId;
  const newPoints = input.newPoints !== undefined ? input.newPoints : q.points;
  if (!OPTION_IDS.includes(newCorrect)) throw new AppError("INVALID_OPTION");
  if (newCorrect === q.correctOptionId && newPoints === q.points) throw new AppError("VALIDATION_ERROR", "The correction doesn't change anything.");

  const answers = await DailyAnswer.find({ questionId: q._id, status: "ANSWERED" }).select("_id userId selectedOptionId").lean();
  const affectedUsers = [...new Set(answers.map((a) => String(a.userId)))].map((id) => new Types.ObjectId(id));

  await withTransaction(async (session) => {
    await Question.updateOne({ _id: q._id }, { $set: { correctOptionId: newCorrect, points: newPoints, updatedBy: actor.userId } }, { session });
    const t = now();
    if (answers.length) {
      await DailyAnswer.bulkWrite(
        answers.map((a) => {
          const { isCorrect, score } = scoreAnswer({
            selectedOptionId: a.selectedOptionId!,
            correctOptionId: newCorrect,
            questionPoints: newPoints,
            config: comp.scoring,
          });
          return { updateOne: { filter: { _id: a._id }, update: { $set: { isCorrect, score, correctedAt: t } } } };
        }),
        { session },
      );
    }
    await AnswerCorrection.create(
      [
        {
          competitionId: comp._id,
          questionId: q._id,
          dayNumber: q.dayNumber,
          adminId: actor.userId,
          reason: input.reason,
          oldValue: { correctOptionId: q.correctOptionId, points: q.points },
          newValue: { correctOptionId: newCorrect, points: newPoints },
          affectedAnswers: answers.length,
          affectedParticipants: affectedUsers.length,
        },
      ],
      { session },
    );
    await recordAudit(
      {
        adminId: actor.userId,
        action: "ANSWER_CORRECTED",
        targetType: "Question",
        targetId: q._id,
        metadata: {
          reason: input.reason,
          dayNumber: q.dayNumber,
          old: { correctOptionId: q.correctOptionId, points: q.points },
          new: { correctOptionId: newCorrect, points: newPoints },
          affectedAnswers: answers.length,
        },
        meta: actor.meta,
      },
      session,
    );
  });

  await runWithConcurrency(affectedUsers, 16, (userId) => recalculateParticipantStats(comp, userId));
  // Final ranks must reflect the correction.
  if (comp.finalizedAt && clockFor(comp).phase === "ENDED") await finalizeCompetition(comp._id);
  return { affectedAnswers: answers.length, affectedParticipants: affectedUsers.length };
}

export async function listCorrections(competitionId: string) {
  await connectDb();
  return AnswerCorrection.find({ competitionId }).sort({ createdAt: -1 }).populate<{ adminId: { name: string; email: string } }>("adminId", "name email").lean();
}
