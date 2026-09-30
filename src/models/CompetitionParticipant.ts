import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * Aggregate per (competition, user). Always derivable from DailyAnswer records via
 * recalculateParticipantStats(); updated inside the same transaction as each answer.
 */
export interface ICompetitionParticipant {
  _id: Types.ObjectId;
  competitionId: Types.ObjectId;
  userId: Types.ObjectId;
  team: string;
  joinedAt: Date;

  totalScore: number;
  correctAnswers: number;
  wrongAnswers: number;
  answeredDays: number;
  missedDays: number;
  currentStreak: number;
  longestStreak: number;
  totalResponseTimeMs: number;
  lastAnsweredAt: Date | null;

  // Frozen at finalization (competition completion); leaderboard reads these.
  finalRank: number | null;
  finalScore: number | null;
  finalCorrect: number | null;
  finalWrong: number | null;
  finalMissed: number | null;
  finalizedAt: Date | null;

  updatedAt: Date;
  createdAt: Date;
}

const ParticipantSchema = new Schema<ICompetitionParticipant>(
  {
    competitionId: { type: Schema.Types.ObjectId, ref: "Competition", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    team: { type: String, default: "General", trim: true, maxlength: 60 },
    joinedAt: { type: Date, required: true },
    totalScore: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    wrongAnswers: { type: Number, default: 0 },
    answeredDays: { type: Number, default: 0 },
    missedDays: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    totalResponseTimeMs: { type: Number, default: 0 },
    lastAnsweredAt: { type: Date, default: null },
    finalRank: { type: Number, default: null },
    finalScore: { type: Number, default: null },
    finalCorrect: { type: Number, default: null },
    finalWrong: { type: Number, default: null },
    finalMissed: { type: Number, default: null },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ParticipantSchema.index({ competitionId: 1, userId: 1 }, { unique: true });
ParticipantSchema.index({ competitionId: 1, finalRank: 1 });
ParticipantSchema.index({ competitionId: 1, totalScore: -1, correctAnswers: -1 });
ParticipantSchema.index({ competitionId: 1, team: 1 });
ParticipantSchema.index({ userId: 1, joinedAt: -1 });

export const CompetitionParticipant: Model<ICompetitionParticipant> =
  (models.CompetitionParticipant as Model<ICompetitionParticipant>) ??
  model<ICompetitionParticipant>("CompetitionParticipant", ParticipantSchema);
