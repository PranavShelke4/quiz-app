/** How each participant's question for a day is chosen (browser-safe: no Node imports). */
export const QUESTION_MODES = ["DAILY", "RANDOM"] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];
export const QUESTION_MODE_LABELS: Record<QuestionMode, string> = {
  DAILY: "Day by day (everyone gets that day's question)",
  RANDOM: "Random for each person (from the whole question bank)",
};
