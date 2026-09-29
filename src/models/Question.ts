import { Schema, model, models, type Model, type Types } from "mongoose";
import { DIFFICULTIES, OPTION_IDS, type Difficulty, type OptionId } from "@/lib/validation/quiz";

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
  questionText: string;
  options: IQuestionOption[];
  correctOptionId: OptionId;
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
    questionText: { type: String, required: true, trim: true, maxlength: 1000 },
    options: {
      type: [OptionSchema],
      validate: [
        {
          validator: (opts: IQuestionOption[]) =>
            opts.length === 4 && OPTION_IDS.every((id, i) => opts[i]?.id === id) && opts.every((o) => o.text.trim().length > 0),
          message: "Exactly 4 non-empty options (A–D) are required",
        },
      ],
    },
    correctOptionId: { type: String, enum: OPTION_IDS, required: true },
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
  if (!this.options.some((o) => o.id === this.correctOptionId)) {
    throw new Error("correctOptionId must match one of the options");
  }
});

QuestionSchema.index({ competitionId: 1, dayNumber: 1 }, { unique: true });
QuestionSchema.index({ competitionId: 1, scheduledDate: 1 });
QuestionSchema.index({ competitionId: 1, status: 1 });

export const Question: Model<IQuestion> =
  (models.Question as Model<IQuestion>) ?? model<IQuestion>("Question", QuestionSchema);
