import { z } from "zod";
import { isValidLocalDate, isValidTimeZone } from "@/lib/time/zoned";
import { TIE_BREAKERS } from "@/lib/leaderboard/ranking";

export const OPTION_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export type OptionId = (typeof OPTION_IDS)[number];
export const optionIdSchema = z.enum(OPTION_IDS, { error: "Choose one of options A–F" });
/** A question has between MIN_OPTIONS and MAX_OPTIONS options, lettered A, B, C… in order. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = OPTION_IDS.length;

/** A set of distinct option ids (at least one). */
const optionIdSetSchema = z
  .array(optionIdSchema)
  .min(1, "Select at least one correct option")
  .max(MAX_OPTIONS)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate option");

export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const MAX_DURATION_DAYS = 90;

/**
 * Answer submission. Deliberately strict: unknown keys such as `score`,
 * `isCorrect` or `userId` are stripped and never reach business logic.
 */
export const submitAnswerSchema = z.object({
  /** Single-answer questions. */
  optionId: optionIdSchema.optional(),
  /** Multiple-answer questions ("select all that apply"). */
  optionIds: optionIdSetSchema.optional(),
  // Optional guards so a stale tab can't submit to a different day than it displays.
  dayNumber: z.number().int().min(1).max(MAX_DURATION_DAYS).optional(),
  questionId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
}).refine((d) => d.optionId !== undefined || d.optionIds !== undefined, { path: ["optionId"], message: "Choose an option" });

export const timezoneSchema = z.string().trim().refine(isValidTimeZone, "Unknown time zone");
export const localDateSchema = z.string().refine(isValidLocalDate, "Use YYYY-MM-DD");

const scoringSchema = z
  .object({
    pointsPerCorrectAnswer: z.number().int().min(1).max(100),
    negativeMarking: z.boolean(),
    negativePoints: z.number().int().min(0).max(100),
  })
  .refine((s) => s.negativeMarking || s.negativePoints === 0, {
    path: ["negativePoints"],
    message: "Negative points must be 0 when negative marking is off",
  });

export const competitionBaseSchema = z.object({
  name: z.string().trim().min(3).max(100),
  category: z.string().trim().max(60).optional(),
  dailyStartTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (e.g. 09:00)")
    .optional(),
  dailyEndTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (e.g. 18:00)")
    .optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes")
    .max(80)
    .optional(),
  description: z.string().trim().max(2000).default(""),
  startLocalDate: localDateSchema,
  timezone: timezoneSchema,
  durationDays: z.number().int().min(1).max(MAX_DURATION_DAYS),
  scoring: scoringSchema,
  tieBreakers: z.array(z.enum(TIE_BREAKERS)).max(TIE_BREAKERS.length).refine((a) => new Set(a).size === a.length, "Duplicate tie-breaker"),
  leaderboardRevealMode: z.enum(["AUTOMATIC", "MANUAL"]),
  leaderboardRevealLocalDateTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm")
    .optional()
    .or(z.literal("")),
  registrationOpen: z.boolean(),
  registrationCloseLocalDate: localDateSchema.optional().or(z.literal("")),
  rules: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
});

export const createCompetitionSchema = competitionBaseSchema;
export const updateCompetitionSchema = competitionBaseSchema.partial();
export type CompetitionInput = z.infer<typeof competitionBaseSchema>;

const optionTextSchema = z.string().trim().min(1, "Option text is required").max(300);

export const questionBaseSchema = z.object({
  competitionId: z.string().regex(/^[a-f0-9]{24}$/i, "Competition is required"),
  dayNumber: z.number().int().min(1, "Day number is required").max(MAX_DURATION_DAYS),
  questionText: z.string().trim().min(5, "Question text is required").max(1000),
  options: z
    .array(z.object({ id: optionIdSchema, text: optionTextSchema }))
    .min(MIN_OPTIONS, `At least ${MIN_OPTIONS} options are required`)
    .max(MAX_OPTIONS, `At most ${MAX_OPTIONS} options are allowed`)
    .refine((opts) => opts.every((o, i) => o.id === OPTION_IDS[i]), "Options must be lettered A, B, C… in order")
    .refine(
      (opts) => new Set(opts.map((o) => o.text.toLowerCase())).size === opts.length,
      "Options must be distinct",
    ),
  /** Legacy single correct answer; prefer `correctOptionIds`. */
  correctOptionId: optionIdSchema.optional(),
  /** One or more correct options. With more than one, participants must select all of them. */
  correctOptionIds: optionIdSetSchema.optional(),
  explanation: z.string().trim().max(2000).default(""),
  category: z.string().trim().max(60).default("General"),
  difficulty: z.enum(DIFFICULTIES).default("MEDIUM"),
  points: z.number().int().min(0).max(100).nullable().default(null),
});

export const createQuestionSchema = questionBaseSchema
  .extend({ status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT") })
  .refine((d) => d.correctOptionId !== undefined || d.correctOptionIds !== undefined, {
    path: ["correctOptionIds"],
    message: "Select at least one correct option",
  });
export const updateQuestionSchema = questionBaseSchema.omit({ competitionId: true }).partial();
export type QuestionInput = z.infer<typeof questionBaseSchema>;

export const correctionSchema = z
  .object({
    newCorrectOptionId: optionIdSchema.optional(),
    newCorrectOptionIds: optionIdSetSchema.optional(),
    newPoints: z.number().int().min(0).max(100).nullable().optional(),
    reason: z.string().trim().min(10, "Please describe the reason (10+ characters)").max(1000),
  })
  .refine((d) => d.newCorrectOptionId !== undefined || d.newCorrectOptionIds !== undefined || d.newPoints !== undefined, "Nothing to correct");

/** Accepts "A", "A,C", "A;C", "A|C", "A C" or "AC" → ["A", "C"]. */
export function parseOptionIdList(raw: string): string[] {
  const t = raw.trim().toUpperCase();
  const parts = /[,;|\s]/.test(t) ? t.split(/[,;|\s]+/) : t.split("");
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Import row (CSV or XML), keyed by the documented header names. optionC–optionF are optional. */
const optionalOptionText = z.string().trim().max(300).optional().transform((v) => v || "");
export const csvQuestionRowSchema = z.object({
  dayNumber: z.coerce.number({ error: "dayNumber must be a number" }).int().min(1).max(MAX_DURATION_DAYS),
  question: z.string().trim().min(5, "question is required").max(1000),
  optionA: optionTextSchema,
  optionB: optionTextSchema,
  optionC: optionalOptionText,
  optionD: optionalOptionText,
  optionE: optionalOptionText,
  optionF: optionalOptionText,
  correctOption: z
    .string({ error: "correctOption is required" })
    .transform((v) => parseOptionIdList(v))
    .pipe(optionIdSetSchema),
  category: z.string().trim().max(60).optional().transform((v) => v || "General"),
  difficulty: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || "MEDIUM")
    .pipe(z.enum(DIFFICULTIES, { error: "difficulty must be EASY, MEDIUM or HARD" })),
  points: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        ctx.addIssue({ code: "custom", message: "points must be an integer 0–100" });
        return z.NEVER;
      }
      return n;
    }),
  explanation: z.string().trim().max(2000).optional().transform((v) => v ?? ""),
});

/** Columns that must be present in a CSV import header. */
export const CSV_REQUIRED_HEADERS = ["dayNumber", "question", "optionA", "optionB", "correctOption"] as const;

export const CSV_IMPORT_HEADERS = [
  "dayNumber",
  "question",
  "optionA",
  "optionB",
  "optionC",
  "optionD",
  "optionE",
  "optionF",
  "correctOption",
  "category",
  "difficulty",
  "points",
] as const;
