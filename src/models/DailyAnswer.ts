import { Schema, model, models, type Model, type Types } from "mongoose";
import { OPTION_IDS, type OptionId } from "@/lib/validation/quiz";

export const ANSWER_STATUSES = ["ANSWERED", "MISSED"] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export interface IDailyAnswer {
  _id: Types.ObjectId;
  competitionId: Types.ObjectId;
  userId: Types.ObjectId;
  dayNumber: number;
  questionId: Types.ObjectId | null;
  selectedOptionId: OptionId | null;
  /** Server-computed; never exposed to participants before the leaderboard is revealed. */
  isCorrect: boolean | null;
  score: number;
  status: AnswerStatus;
  answeredAt: Date | null;
  /** answeredAt − day opening time; used for the response-time tie-breaker. */
  responseTimeMs: number | null;
  // Anti-cheat metadata (admin-only).
  ip: string | null;
  userAgent: string | null;
  sessionId: Types.ObjectId | null;
  correctedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const DailyAnswerSchema = new Schema<IDailyAnswer>(
  {
    competitionId: { type: Schema.Types.ObjectId, ref: "Competition", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dayNumber: { type: Number, required: true, min: 1 },
    questionId: { type: Schema.Types.ObjectId, ref: "Question", default: null },
    selectedOptionId: { type: String, enum: [...OPTION_IDS, null], default: null },
    isCorrect: { type: Boolean, default: null },
    score: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ANSWER_STATUSES, required: true },
    answeredAt: { type: Date, default: null },
    responseTimeMs: { type: Number, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 400 },
    sessionId: { type: Schema.Types.ObjectId, default: null },
    correctedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// THE integrity guarantee: one record per user per competition day, enforced by the DB.
DailyAnswerSchema.index({ competitionId: 1, userId: 1, dayNumber: 1 }, { unique: true });
DailyAnswerSchema.index({ competitionId: 1, dayNumber: 1, status: 1 });
DailyAnswerSchema.index({ userId: 1, competitionId: 1 });
DailyAnswerSchema.index({ questionId: 1 });
DailyAnswerSchema.index({ competitionId: 1, ip: 1, dayNumber: 1 });
DailyAnswerSchema.index({ answeredAt: -1 });

export const DailyAnswer: Model<IDailyAnswer> =
  (models.DailyAnswer as Model<IDailyAnswer>) ?? model<IDailyAnswer>("DailyAnswer", DailyAnswerSchema);
