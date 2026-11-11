import { Schema, type Model, type Types } from "mongoose";
import { defineModel } from "@/lib/db/model";
import { DIFFICULTIES, MAX_OPTIONS, MIN_OPTIONS, OPTION_IDS, type Difficulty, type OptionId } from "@/lib/validation/quiz";

export const QUESTION_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export interface IQuestionOption {
  id: OptionId;
  text: string;
}

export interface IQuestion {
  _id: Types.ObjectId;
  competitionId: Types.ObjectId;
  dayNumber: number;
  /** Version number within the day's pool (1, 2, …). Each participant gets one version. */
  variant: number;
  questionText: string;
  options: IQuestionOption[];
  /** First correct option. Kept for older documents/readers; mirrors correctOptionIds[0]. */
  correctOptionId: OptionId;
  /** All correct options. More than one → participants must select every one of them. */
  correctOptionIds: OptionId[];
  explanation: string;
  category: string;
  difficulty: Difficulty;
  /** Points for a correct answer; null → competition default. */
  points: number | null;
  status: QuestionStatus;
  /** Opening instant of this question's day (derived; kept in sync with the competition). */
  scheduledDate: Date;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const OptionSchema = new Schema<IQuestionOption>(
  {
    id: { type: String, enum: OPTION_IDS, required: true },
    text: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { _id: false },
);

const QuestionSchema = new Schema<IQuestion>(
  {
    competitionId: { type: Schema.Types.ObjectId, ref: "Competition", required: true },
    dayNumber: { type: Number, required: true, min: 1 },
    variant: { type: Number, default: 1, min: 1 },
    questionText: { type: String, required: true, trim: true, maxlength: 1000 },
    options: {
      type: [OptionSchema],
      validate: [
        {
          validator: (opts: IQuestionOption[]) =>
            opts.length >= MIN_OPTIONS &&
            opts.length <= MAX_OPTIONS &&
            opts.every((o, i) => o.id === OPTION_IDS[i] && o.text.trim().length > 0),
          message: `Between ${MIN_OPTIONS} and ${MAX_OPTIONS} non-empty options, lettered A, B, C… in order, are required`,
        },
      ],
    },
    correctOptionId: { type: String, enum: OPTION_IDS, required: true },
    correctOptionIds: { type: [{ type: String, enum: OPTION_IDS }], default: undefined },
    explanation: { type: String, default: "", maxlength: 2000 },
    category: { type: String, default: "General", trim: true, maxlength: 60 },
    difficulty: { type: String, enum: DIFFICULTIES, default: "MEDIUM" },
    points: { type: Number, default: null, min: 0 },
    status: { type: String, enum: QUESTION_STATUSES, default: "DRAFT" },
    scheduledDate: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

QuestionSchema.pre("validate", function () {
  // Keep the two answer-key fields in sync; correctOptionIds is the source of truth when set.
  if (this.correctOptionIds?.length) this.correctOptionId = this.correctOptionIds[0]!;
  else if (this.correctOptionId) this.correctOptionIds = [this.correctOptionId];
  const ids = this.correctOptionIds ?? [];
  if (!ids.length || !ids.every((id) => this.options.some((o) => o.id === id))) {
    throw new Error("Every correct option must match one of the options");
  }
  if (new Set(ids).size !== ids.length) throw new Error("Correct options must be distinct");
});

// A day may hold several versions (question pools); versions are unique within the day.
QuestionSchema.index({ competitionId: 1, dayNumber: 1, variant: 1 }, { unique: true });
QuestionSchema.index({ competitionId: 1, scheduledDate: 1 });
QuestionSchema.index({ competitionId: 1, status: 1 });

export const Question: Model<IQuestion> =
  defineModel<IQuestion>("Question", QuestionSchema);
