import { Schema, type Model, type Types } from "mongoose";
import { defineModel } from "@/lib/db/model";
import { ATTEMPT_EVENTS, LOCK_REASONS, type AttemptEventType, type LockReason } from "@/lib/quiz/anticheat-config";
import { OPTION_IDS, type OptionId } from "@/lib/validation/quiz";

export const ATTEMPT_STATUSES = ["STARTED", "SUBMITTED", "LOCKED", "EXPIRED"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * One timed attempt at a day's question (anti-cheat mode). Created when the
 * participant presses Start; the question text is only sent after that.
 */
export interface IQuizAttempt {
  _id: Types.ObjectId;
  competitionId: Types.ObjectId;
  userId: Types.ObjectId;
  dayNumber: number;
  questionId: Types.ObjectId;
  /** Original option ids in the order this participant sees them (display A = optionOrder[0]). */
  optionOrder: OptionId[];
  startedAt: Date;
  deadlineAt: Date;
  status: AttemptStatus;
  lockReason: LockReason | null;
  endedAt: Date | null;
  /** Session that started the attempt; submissions from any other session are rejected. */
  sessionId: Types.ObjectId | null;
  ip: string | null;
  userAgent: string | null;
  events: { type: AttemptEventType; at: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

const AttemptSchema = new Schema<IQuizAttempt>(
  {
    competitionId: { type: Schema.Types.ObjectId, ref: "Competition", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dayNumber: { type: Number, required: true, min: 1 },
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    optionOrder: { type: [{ type: String, enum: OPTION_IDS }], required: true },
    startedAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true },
    status: { type: String, enum: ATTEMPT_STATUSES, default: "STARTED" },
    lockReason: { type: String, enum: [...LOCK_REASONS, null], default: null },
    endedAt: { type: Date, default: null },
    sessionId: { type: Schema.Types.ObjectId, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 400 },
    events: {
      type: [new Schema({ type: { type: String, enum: ATTEMPT_EVENTS, required: true }, at: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);

// One attempt per participant per day: a second Start can't open a fresh copy.
AttemptSchema.index({ competitionId: 1, userId: 1, dayNumber: 1 }, { unique: true });
AttemptSchema.index({ competitionId: 1, dayNumber: 1, status: 1 });

export const QuizAttempt: Model<IQuizAttempt> = defineModel<IQuizAttempt>("QuizAttempt", AttemptSchema);
