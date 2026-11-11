import { z } from "zod";
import { isValidLocalDate, isValidTimeZone } from "@/lib/time/zoned";
import { TIE_BREAKERS } from "@/lib/leaderboard/ranking";
import { ATTEMPT_EVENTS, MAX_TIME_LIMIT_SECONDS, MIN_TIME_LIMIT_SECONDS } from "@/lib/quiz/anticheat-config";

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
 * For PATCH schemas: Zod 4's .partial() still applies .default() values, so an update that
 * omits a field would silently reset it. Strip defaults first so omitted fields stay omitted.
 */
function withoutDefaults<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, v]) => [k, v instanceof z.ZodDefault ? v.unwrap() : v]),
  ) as { [K in keyof T]: T[K] extends z.ZodDefault<infer I> ? I : T[K] };
  return z.object(shape);
}

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

/** A titled group of rules shown on /rules, e.g. "Scoring" with its own short intro. */
export const ruleSectionSchema = z.object({
  title: z.string().trim().min(1, "Section title is required").max(100),
  description: z.string().trim().max(500).default(""),
  rules: z.array(z.string().trim().min(1, "Rule text is required").max(500)).max(30),
});
export type RuleSection = z.infer<typeof ruleSectionSchema>;

export const antiCheatSchema = z.object({
  enabled: z.boolean(),
  timeLimitSeconds: z.number().int().min(MIN_TIME_LIMIT_SECONDS, `At least ${MIN_TIME_LIMIT_SECONDS} seconds`).max(MAX_TIME_LIMIT_SECONDS, `At most ${MAX_TIME_LIMIT_SECONDS} seconds`),
  shuffleOptions: z.boolean(),
  lockOnLeave: z.boolean(),
  watermark: z.boolean(),
  requireFullscreen: z.boolean(),
  flagFastAnswers: z.boolean().default(true),
});

export const attemptEventSchema = z.object({
  type: z.enum(ATTEMPT_EVENTS),
  dayNumber: z.number().int().min(1).max(MAX_DURATION_DAYS).optional(),
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
  /** Legacy flat list; kept in sync with ruleSections (flattened) when sections are sent. */
  rules: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  ruleSections: z.array(ruleSectionSchema).max(15).optional(),
  antiCheat: antiCheatSchema.optional(),
});

export const createCompetitionSchema = competitionBaseSchema;
export const updateCompetitionSchema = withoutDefaults(competitionBaseSchema).partial();
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
export const updateQuestionSchema = withoutDefaults(questionBaseSchema.omit({ competitionId: true })).partial();
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

/** Import row (CSV or Excel), keyed by the documented header names. optionC–optionF are optional. */
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

/**
 * Maps a spreadsheet header to its canonical column name, so "Day", "Day Number",
 * "Option A", "Correct Answer" or "Score" work as well as the exact names.
 * Unknown headers are returned unchanged (and ignored by the row schema).
 */
const HEADER_ALIASES: Record<string, string> = {
  day: "dayNumber",
  daynumber: "dayNumber",
  dayno: "dayNumber",
  question: "question",
  questiontext: "question",
  correctoption: "correctOption",
  correctoptions: "correctOption",
  correctanswer: "correctOption",
  correctanswers: "correctOption",
  correct: "correctOption",
  answer: "correctOption",
  answerkey: "correctOption",
  category: "category",
  difficulty: "difficulty",
  level: "difficulty",
  points: "points",
  point: "points",
  score: "points",
  marks: "points",
  explanation: "explanation",
};
export function normalizeImportHeader(header: string): string {
  const key = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  const option = /^(?:option|opt)([a-f])$/.exec(key);
  if (option) return `option${option[1]!.toUpperCase()}`;
  return HEADER_ALIASES[key] ?? header.trim();
}

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
