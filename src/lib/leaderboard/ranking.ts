/**
 * Deterministic leaderboard ranking.
 *
 * Primary key is always totalScore DESC. Tie-breakers are configurable per
 * competition and applied in order. Participants tied on *every* configured
 * criterion share a rank (standard competition ranking: 1, 2, 2, 4); their
 * display order is then stabilised by userId so output is fully deterministic.
 */

export const TIE_BREAKERS = [
  "CORRECT_ANSWERS_DESC",
  "TOTAL_RESPONSE_TIME_ASC",
  "LAST_ANSWER_AT_ASC",
  "MISSED_DAYS_ASC",
  "JOINED_AT_ASC",
] as const;

export type TieBreaker = (typeof TIE_BREAKERS)[number];

export const DEFAULT_TIE_BREAKERS: TieBreaker[] = ["CORRECT_ANSWERS_DESC", "TOTAL_RESPONSE_TIME_ASC"];

export const TIE_BREAKER_LABELS: Record<TieBreaker, string> = {
  CORRECT_ANSWERS_DESC: "More correct answers ranks higher",
  TOTAL_RESPONSE_TIME_ASC: "Lower total answer time (time from question opening to submission, summed over answered days) ranks higher",
  LAST_ANSWER_AT_ASC: "Earlier final submission ranks higher",
  MISSED_DAYS_ASC: "Fewer missed days ranks higher",
  JOINED_AT_ASC: "Earlier registration ranks higher",
};

export interface RankableParticipant {
  userId: string;
  totalScore: number;
  correctAnswers: number;
  missedDays: number;
  totalResponseTimeMs: number;
  lastAnsweredAt: Date | null;
  joinedAt: Date;
}

export type Ranked<T> = T & { rank: number };

function time(d: Date | null): number {
  // Participants who never answered sort after everyone who did.
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

function compareBy(tb: TieBreaker, a: RankableParticipant, b: RankableParticipant): number {
  switch (tb) {
    case "CORRECT_ANSWERS_DESC":
      return b.correctAnswers - a.correctAnswers;
    case "TOTAL_RESPONSE_TIME_ASC":
      return a.totalResponseTimeMs - b.totalResponseTimeMs;
    case "LAST_ANSWER_AT_ASC":
      return time(a.lastAnsweredAt) - time(b.lastAnsweredAt);
    case "MISSED_DAYS_ASC":
      return a.missedDays - b.missedDays;
    case "JOINED_AT_ASC":
      return a.joinedAt.getTime() - b.joinedAt.getTime();
  }
}

export function compareParticipants(
  a: RankableParticipant,
  b: RankableParticipant,
  tieBreakers: readonly TieBreaker[],
): number {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  for (const tb of tieBreakers) {
    const c = compareBy(tb, a, b);
    if (c !== 0 && !Number.isNaN(c)) return c;
  }
  return 0;
}

export function rankParticipants<T extends RankableParticipant>(
  participants: readonly T[],
  tieBreakers: readonly TieBreaker[] = DEFAULT_TIE_BREAKERS,
): Ranked<T>[] {
  const sorted = [...participants].sort((a, b) => {
    const c = compareParticipants(a, b, tieBreakers);
    return c !== 0 ? c : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  const ranked: Ranked<T>[] = [];
  sorted.forEach((p, i) => {
    const prev = ranked[i - 1];
    const tied = prev && compareParticipants(prev, p, tieBreakers) === 0;
    ranked.push({ ...p, rank: tied ? prev.rank : i + 1 });
  });
  return ranked;
}
