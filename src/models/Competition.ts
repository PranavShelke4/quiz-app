import { Schema, model, models, type Model, type Types } from "mongoose";
import { TIE_BREAKERS, DEFAULT_TIE_BREAKERS, type TieBreaker } from "@/lib/leaderboard/ranking";

export const COMPETITION_STATUSES = ["DRAFT", "SCHEDULED", "ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

export const REVEAL_MODES = ["AUTOMATIC", "MANUAL"] as const;
export type RevealMode = (typeof REVEAL_MODES)[number];

export interface ICompetition {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description: string;

  /** UTC instant of local 00:00 on Day 1 in `timezone`. */
  startDate: Date;
  /** Exclusive end: local 00:00 after the final day (derived from start + duration). */
  endDate: Date;
  durationDays: number;
  timezone: string;

  /**
   * Stored lifecycle status. Time-based gating (day windows, submission cut-offs)
   * is always derived from startDate/endDate so a delayed cron can't open a hole;
   * cron + lazy sync keep this field in step for admin/reporting.
   */
  status: CompetitionStatus;

  registrationOpen: boolean;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;

  scoring: { pointsPerCorrectAnswer: number; negativeMarking: boolean; negativePoints: number };
  tieBreakers: TieBreaker[];

  leaderboardRevealMode: RevealMode;
  /** For AUTOMATIC mode; defaults to endDate. Never earlier than endDate. */
  leaderboardRevealDate: Date | null;
  leaderboardRevealed: boolean;
  leaderboardRevealedAt: Date | null;
  /** Set when an admin manually reveals/hides; automatic reveal never overrides an admin decision. */
  leaderboardRevealOverridden: boolean;

  rules: string[];

  publishedAt: Date | null;
  activatedAt: Date | null;
  completedAt: Date | null;
  finalizedAt: Date | null;
  archivedAt: Date | null;
  /** Rollover bookkeeping: all days <= this have MISSED records for every participant. */
  missedProcessedThroughDay: number;

  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const CompetitionSchema = new Schema<ICompetition>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", maxlength: 2000 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    durationDays: { type: Number, required: true, min: 1, max: 90, default: 30 },
    timezone: { type: String, required: true, default: "Asia/Kolkata" },
    status: { type: String, enum: COMPETITION_STATUSES, default: "DRAFT", required: true },
    registrationOpen: { type: Boolean, default: true },
    registrationOpensAt: { type: Date, default: null },
    registrationClosesAt: { type: Date, default: null },
    scoring: {
      pointsPerCorrectAnswer: { type: Number, default: 1, min: 1 },
      negativeMarking: { type: Boolean, default: false },
      negativePoints: { type: Number, default: 0, min: 0 },
    },
    tieBreakers: { type: [{ type: String, enum: TIE_BREAKERS }], default: () => [...DEFAULT_TIE_BREAKERS] },
    leaderboardRevealMode: { type: String, enum: REVEAL_MODES, default: "AUTOMATIC" },
    leaderboardRevealDate: { type: Date, default: null },
    leaderboardRevealed: { type: Boolean, default: false },
    leaderboardRevealedAt: { type: Date, default: null },
    leaderboardRevealOverridden: { type: Boolean, default: false },
    rules: { type: [String], default: [] },
    publishedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    finalizedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    missedProcessedThroughDay: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

CompetitionSchema.index({ slug: 1 }, { unique: true });
CompetitionSchema.index({ status: 1, startDate: 1 });
CompetitionSchema.index({ startDate: 1, endDate: 1 });

export const Competition: Model<ICompetition> =
  (models.Competition as Model<ICompetition>) ?? model<ICompetition>("Competition", CompetitionSchema);
