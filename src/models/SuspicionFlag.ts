import { Schema, model, models, type Model, type Types } from "mongoose";

export const FLAG_TYPES = ["SUSPICIOUS_ACTIVITY", "MULTIPLE_ACCOUNTS", "RAPID_SUBMISSIONS"] as const;
export type FlagType = (typeof FLAG_TYPES)[number];
export const FLAG_STATUSES = ["OPEN", "DISMISSED", "CONFIRMED"] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

/**
 * Heuristic signal for admin review. Flags never change scores or accounts
 * automatically — an admin decides.
 */
export interface ISuspicionFlag {
  _id: Types.ObjectId;
  competitionId: Types.ObjectId;
  userId: Types.ObjectId;
  type: FlagType;
  dayNumber: number | null;
  details: Record<string, unknown>;
  status: FlagStatus;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SuspicionFlagSchema = new Schema<ISuspicionFlag>(
  {
    competitionId: { type: Schema.Types.ObjectId, ref: "Competition", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: FLAG_TYPES, required: true },
    dayNumber: { type: Number, default: null },
    details: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: FLAG_STATUSES, default: "OPEN" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null, maxlength: 1000 },
  },
  { timestamps: true },
);

SuspicionFlagSchema.index({ competitionId: 1, userId: 1, type: 1, dayNumber: 1 }, { unique: true });
SuspicionFlagSchema.index({ status: 1, createdAt: -1 });

export const SuspicionFlag: Model<ISuspicionFlag> =
  (models.SuspicionFlag as Model<ISuspicionFlag>) ?? model<ISuspicionFlag>("SuspicionFlag", SuspicionFlagSchema);
