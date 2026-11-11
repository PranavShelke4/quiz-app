/**
 * Pure scoring rules. The client never supplies score or correctness —
 * these functions are only ever called server-side with DB values.
 */

export interface ScoringConfig {
  pointsPerCorrectAnswer: number;
  negativeMarking: boolean;
  negativePoints: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  pointsPerCorrectAnswer: 1,
  negativeMarking: false,
  negativePoints: 0,
};

export interface ScoredAnswer {
  isCorrect: boolean;
  score: number;
}

/** Points a correct answer is worth: per-question override, else competition default. */
export function pointsForQuestion(questionPoints: number | null | undefined, config: ScoringConfig): number {
  return typeof questionPoints === "number" && questionPoints >= 0 ? questionPoints : config.pointsPerCorrectAnswer;
}

/** Correct options of a question; falls back to the legacy single `correctOptionId`. */
export function correctIdsOf(q: { correctOptionIds?: readonly string[] | null; correctOptionId?: string | null }): string[] {
  if (q.correctOptionIds && q.correctOptionIds.length) return [...q.correctOptionIds];
  return q.correctOptionId ? [q.correctOptionId] : [];
}

/** Options a participant selected; falls back to the legacy single `selectedOptionId`. */
export function selectedIdsOf(a: { selectedOptionIds?: readonly string[] | null; selectedOptionId?: string | null }): string[] {
  if (a.selectedOptionIds && a.selectedOptionIds.length) return [...a.selectedOptionIds];
  return a.selectedOptionId ? [a.selectedOptionId] : [];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/**
 * Scores an answer. With several correct options, the answer is correct only when the
 * selection matches the correct set exactly (all-or-nothing, no partial credit).
 */
export function scoreAnswer(params: {
  selectedOptionId?: string | null;
  selectedOptionIds?: readonly string[] | null;
  correctOptionId?: string | null;
  correctOptionIds?: readonly string[] | null;
  questionPoints?: number | null;
  config: ScoringConfig;
}): ScoredAnswer {
  const isCorrect = sameSet(selectedIdsOf(params), correctIdsOf(params));
  if (isCorrect) {
    return { isCorrect, score: pointsForQuestion(params.questionPoints, params.config) };
  }
  const penalty = params.config.negativeMarking ? Math.abs(params.config.negativePoints) : 0;
  // Avoid "-0" leaking into JSON/UI.
  return { isCorrect, score: penalty === 0 ? 0 : -penalty };
}

/** A missed day always scores 0, regardless of negative marking. */
export const MISSED_SCORE = 0;
