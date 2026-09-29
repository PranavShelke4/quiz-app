import { computeStreaks } from "@/lib/quiz/streak";
import type { CompetitionClock } from "@/lib/competition/schedule";

export interface AnswerRecord {
  dayNumber: number;
  status: "ANSWERED" | "MISSED";
  isCorrect: boolean | null;
  score: number;
  answeredAt: Date | null;
  responseTimeMs: number | null;
}

export interface ParticipantStats {
  totalScore: number;
  correctAnswers: number;
  wrongAnswers: number;
  answeredDays: number;
  missedDays: number;
  currentStreak: number;
  longestStreak: number;
  totalResponseTimeMs: number;
  lastAnsweredAt: Date | null;
}

/** Pure: derives every aggregate from source answer records. */
export function computeParticipantStats(answers: readonly AnswerRecord[], clock: Pick<CompetitionClock, "phase" | "currentDay" | "durationDays">): ParticipantStats {
  const stats: ParticipantStats = {
    totalScore: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    answeredDays: 0,
    missedDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    totalResponseTimeMs: 0,
    lastAnsweredAt: null,
  };
  const answeredDays: number[] = [];
  for (const a of answers) {
    stats.totalScore += a.score;
    if (a.status === "MISSED") {
      stats.missedDays += 1;
      continue;
    }
    stats.answeredDays += 1;
    answeredDays.push(a.dayNumber);
    if (a.isCorrect) stats.correctAnswers += 1;
    else stats.wrongAnswers += 1;
    stats.totalResponseTimeMs += a.responseTimeMs ?? 0;
    if (a.answeredAt && (!stats.lastAnsweredAt || a.answeredAt > stats.lastAnsweredAt)) stats.lastAnsweredAt = a.answeredAt;
  }
  const streaks =
    clock.phase === "NOT_STARTED"
      ? { currentStreak: 0, longestStreak: 0 }
      : computeStreaks({
          answeredDays,
          currentDay: clock.phase === "ENDED" ? clock.durationDays : (clock.currentDay ?? 0),
          todayOpen: clock.phase === "ACTIVE",
        });
  stats.currentStreak = streaks.currentStreak;
  stats.longestStreak = streaks.longestStreak;
  return stats;
}
