import { Schema, model, models, type Model, type Types } from "mongoose";

/** Immutable record of an administrative correction to a question's scoring. */
export interface IAnswerCorrection {
  _id: Types.ObjectId;
  competitionId: Types.ObjectId;
  questionId: Types.ObjectId;
  dayNumber: number;
  adminId: Types.ObjectId;
  reason: string;
  oldValue: { correctOptionId: string; points: number | null };
  newValue: { correctOptionId: string; points: number | null };
  affectedAnswers: number;
  affectedParticipants: number;
  createdAt: Date;
}

const AnswerCorrectionSchema = new Schema<IAnswerCorrection>(
  {
    competitionId: { type: Schema.Types.ObjectId, ref: "Competition", required: true },
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    dayNumber: { type: Number, required: true },
    adminId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    oldValue: { correctOptionId: String, points: { type: Number, default: null } },
    newValue: { correctOptionId: String, points: { type: Number, default: null } },
    affectedAnswers: { type: Number, default: 0 },
    affectedParticipants: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AnswerCorrectionSchema.index({ competitionId: 1, createdAt: -1 });
AnswerCorrectionSchema.index({ questionId: 1 });

export const AnswerCorrection: Model<IAnswerCorrection> =
  (models.AnswerCorrection as Model<IAnswerCorrection>) ??
  model<IAnswerCorrection>("AnswerCorrection", AnswerCorrectionSchema);
