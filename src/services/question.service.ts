import { Types } from "mongoose";
import { z } from "zod";
import { getDayAccess, getDayWindow } from "@/lib/competition/schedule";
import { parseCsvWithHeader } from "@/lib/csv";
import { connectDb, withTransaction } from "@/lib/db/mongoose";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { correctIdsOf, scoreAnswer } from "@/lib/quiz/scoring";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { escapeRegex } from "@/lib/validation/common";
import {
  CSV_REQUIRED_HEADERS,
  OPTION_IDS,
  csvQuestionRowSchema,
  normalizeImportHeader,
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
    correctOptionIds: correctIdsOf(q) as OptionId[],
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

/**
 * Resolves the answer key from either `correctOptionIds` or the legacy `correctOptionId`,
 * checks it against the options, and returns both fields ready to persist.
 */
function answerKey(
  options: { id: string }[],
  input: { correctOptionId?: OptionId; correctOptionIds?: OptionId[] },
): { correctOptionId: OptionId; correctOptionIds: OptionId[] } {
  const ids = (input.correctOptionIds?.length ? input.correctOptionIds : input.correctOptionId ? [input.correctOptionId] : []) as OptionId[];
  const sorted = OPTION_IDS.filter((id) => ids.includes(id));
  if (!sorted.length) throw new AppError("VALIDATION_ERROR", "Select at least one correct option.", { fields: { correctOptionIds: ["Select at least one correct option"] } });
  if (!sorted.every((id) => options.some((o) => o.id === id))) {
    throw new AppError("VALIDATION_ERROR", "Correct option must match one of the options.", { fields: { correctOptionIds: ["Must match one of the options"] } });
  }
  return { correctOptionId: sorted[0]!, correctOptionIds: sorted };
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
        ...answerKey(input.options, input),
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
  const keyChanged = input.correctOptionIds !== undefined || input.correctOptionId !== undefined;
  // Re-validate the key whenever options or the key change (e.g. an option was removed).
  const key = answerKey(options, keyChanged ? input : { correctOptionIds: correctIdsOf(q) as OptionId[] });

  const $set: Record<string, unknown> = { ...input, ...key, updatedBy: actor.userId };
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

/**
 * Deletes several questions at once. Same rules as deleting one: draft competition,
 * day not yet opened, no answers. All-or-nothing: if any is blocked, none is deleted.
 */
export async function deleteQuestions(competitionId: string, ids: string[], actor: Actor) {
  await connectDb();
  const comp = await getCompetitionById(competitionId);
  if (comp.status !== "DRAFT") {
    throw new AppError("COMPETITION_LOCKED", "Unpublish the competition before deleting questions — every day of a published competition needs a question.");
  }
  const unique = [...new Set(ids)];
  const qs = await Question.find({ _id: { $in: unique }, competitionId: comp._id }).select("dayNumber").lean();
  if (qs.length !== unique.length) throw new AppError("QUESTION_NOT_FOUND", "Some questions were not found in this competition. Refresh and try again.");
  const locked = qs.filter((q) => isQuestionLocked(comp, q.dayNumber)).map((q) => q.dayNumber);
  if (locked.length) throw new AppError("QUESTION_LOCKED", `Day(s) ${locked.sort((a, b) => a - b).join(", ")} have already opened.`);
  const answered = await DailyAnswer.distinct("questionId", { questionId: { $in: qs.map((q) => q._id) } });
  if (answered.length) throw new AppError("QUESTION_LOCKED", `${answered.length} of the selected questions have answers.`);
  const res = await Question.deleteMany({ _id: { $in: qs.map((q) => q._id) }, competitionId: comp._id });
  await recordAudit({
    adminId: actor.userId,
    action: "QUESTION_DELETED",
    targetType: "Competition",
    targetId: comp._id,
    metadata: { bulk: true, count: res.deletedCount, days: qs.map((q) => q.dayNumber).sort((a, b) => a - b) },
    meta: actor.meta,
  });
  return { deleted: res.deletedCount ?? 0 };
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
      correctOptionIds: correctIdsOf(q) as OptionId[],
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
  /** Either raw CSV text… */
  csv?: string;
  /** …or rows already read from an .xlsx file in the browser, keyed by their header cells. */
  records?: Record<string, string>[];
  dryRun: boolean;
  skipInvalid: boolean;
  publish: boolean;
  overwrite: boolean;
  actor: Actor;
}): Promise<ImportReport> {
  await connectDb();
  const comp = await getCompetitionById(params.competitionId);
  if (comp.status === "COMPLETED" || comp.status === "ARCHIVED") throw new AppError("COMPETITION_LOCKED");

  let raw: { headers: string[]; records: Record<string, string>[] };
  if (params.records) {
    raw = { headers: [...new Set(params.records.flatMap((r) => Object.keys(r)))], records: params.records };
  } else {
    try {
      raw = parseCsvWithHeader(params.csv ?? "");
    } catch (e) {
      throw new AppError("VALIDATION_ERROR", `Couldn't read the CSV: ${(e as Error).message}`);
    }
  }
  // Accept friendly headers ("Day", "Option A", "Correct Answer"…) for both CSV and Excel.
  const parsed = {
    headers: raw.headers.map(normalizeImportHeader),
    records: raw.records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [normalizeImportHeader(k), v]))),
  };
  const missingHeaders = CSV_REQUIRED_HEADERS.filter((h) => !parsed.headers.includes(h));
  if (missingHeaders.length) {
    throw new AppError("VALIDATION_ERROR", `Missing required column(s): ${missingHeaders.join(", ")}`);
  }
  if (parsed.records.length === 0) throw new AppError("VALIDATION_ERROR", "The file has no data rows.");
  if (parsed.records.length > 500) throw new AppError("VALIDATION_ERROR", "Import at most 500 rows at a time.");

  const existing = await Question.find({ competitionId: comp._id }).select("dayNumber").lean();
  const existingDays = new Set(existing.map((q) => q.dayNumber));
  const seenDays = new Map<number, number>();
  const errors: ImportRowError[] = [];
  const valid: { row: number; data: z.infer<typeof csvQuestionRowSchema>; options: { id: OptionId; text: string }[] }[] = [];

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
      // Options fill left to right: A and B are required, C–F optional but without gaps.
      const raw = [d.optionA, d.optionB, d.optionC, d.optionD, d.optionE, d.optionF];
      const lastFilled = raw.reduce((last, t, i) => (t ? i : last), -1);
      const gap = raw.slice(0, lastFilled + 1).findIndex((t) => !t);
      if (gap !== -1) rowErrors.push(`option${OPTION_IDS[gap]}: is empty but a later option is filled`);
      const options = raw.slice(0, lastFilled + 1).map((text, i) => ({ id: OPTION_IDS[i]!, text }));
      if (new Set(options.map((o) => o.text.toLowerCase())).size !== options.length) rowErrors.push("options: all options must be different");
      const missing = d.correctOption.filter((id) => !options.some((o) => o.id === id));
      if (missing.length) rowErrors.push(`correctOption: ${missing.join(", ")} ${missing.length === 1 ? "is not an option" : "are not options"} in this row`);
      seenDays.set(d.dayNumber, row);
      if (!rowErrors.length) valid.push({ row, data: d, options });
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
    for (const { data, options } of valid) {
      const doc = {
        competitionId: comp._id,
        dayNumber: data.dayNumber,
        questionText: data.question,
        options,
        ...answerKey(options, { correctOptionIds: data.correctOption }),
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
  input: { newCorrectOptionId?: OptionId; newCorrectOptionIds?: OptionId[]; newPoints?: number | null; reason: string },
  actor: Actor,
) {
  await connectDb();
  const q = await getQuestion(questionId);
  const comp = await getCompetitionById(q.competitionId);
  if (!isQuestionLocked(comp, q.dayNumber)) {
    throw new AppError("CONFLICT", "This question hasn't opened yet — edit it directly instead of issuing a correction.");
  }
  const oldIds = correctIdsOf(q) as OptionId[];
  const keyChanged = input.newCorrectOptionIds !== undefined || input.newCorrectOptionId !== undefined;
  let newKey: { correctOptionId: OptionId; correctOptionIds: OptionId[] };
  try {
    newKey = keyChanged
      ? answerKey(q.options, { correctOptionIds: input.newCorrectOptionIds, correctOptionId: input.newCorrectOptionId })
      : { correctOptionId: q.correctOptionId, correctOptionIds: oldIds };
  } catch {
    throw new AppError("INVALID_OPTION");
  }
  const newPoints = input.newPoints !== undefined ? input.newPoints : q.points;
  const sameKey = newKey.correctOptionIds.join() === [...oldIds].sort().join();
  if (sameKey && newPoints === q.points) throw new AppError("VALIDATION_ERROR", "The correction doesn't change anything.");

  const answers = await DailyAnswer.find({ questionId: q._id, status: "ANSWERED" }).select("_id userId selectedOptionId selectedOptionIds").lean();
  const affectedUsers = [...new Set(answers.map((a) => String(a.userId)))].map((id) => new Types.ObjectId(id));

  await withTransaction(async (session) => {
    await Question.updateOne({ _id: q._id }, { $set: { ...newKey, points: newPoints, updatedBy: actor.userId } }, { session });
    const t = now();
    if (answers.length) {
      await DailyAnswer.bulkWrite(
        answers.map((a) => {
          const { isCorrect, score } = scoreAnswer({
            selectedOptionId: a.selectedOptionId,
            selectedOptionIds: a.selectedOptionIds,
            correctOptionIds: newKey.correctOptionIds,
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
          oldValue: { correctOptionId: q.correctOptionId, correctOptionIds: oldIds, points: q.points },
          newValue: { ...newKey, points: newPoints },
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
          old: { correctOptionIds: oldIds, points: q.points },
          new: { correctOptionIds: newKey.correctOptionIds, points: newPoints },
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
