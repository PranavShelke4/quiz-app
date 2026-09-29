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

export function scoreAnswer(params: {
  selectedOptionId: string;
  correctOptionId: string;
  questionPoints?: number | null;
  config: ScoringConfig;
}): ScoredAnswer {
  const isCorrect = params.selectedOptionId === params.correctOptionId;
  if (isCorrect) {
    return { isCorrect, score: pointsForQuestion(params.questionPoints, params.config) };
  }
  const penalty = params.config.negativeMarking ? Math.abs(params.config.negativePoints) : 0;
  // Avoid "-0" leaking into JSON/UI.
  return { isCorrect, score: penalty === 0 ? 0 : -penalty };
}

/** A missed day always scores 0, regardless of negative marking. */
export const MISSED_SCORE = 0;
