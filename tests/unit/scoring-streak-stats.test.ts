import { describe, expect, it } from "vitest";
import { DEFAULT_SCORING, pointsForQuestion, scoreAnswer } from "@/lib/quiz/scoring";
import { computeParticipantStats, type AnswerRecord } from "@/lib/quiz/stats";
import { computeStreaks } from "@/lib/quiz/streak";

describe("scoring", () => {
  it("correct answer = 1 point by default", () => {
    expect(scoreAnswer({ selectedOptionId: "B", correctOptionId: "B", config: DEFAULT_SCORING })).toEqual({ isCorrect: true, score: 1 });
  });

  it("incorrect answer = 0 points by default (no negative zero)", () => {
    const r = scoreAnswer({ selectedOptionId: "A", correctOptionId: "B", config: DEFAULT_SCORING });
    expect(r).toEqual({ isCorrect: false, score: 0 });
    expect(Object.is(r.score, -0)).toBe(false);
  });

  it("supports configurable points and negative marking", () => {
    const config = { pointsPerCorrectAnswer: 4, negativeMarking: true, negativePoints: 1 };
    expect(scoreAnswer({ selectedOptionId: "C", correctOptionId: "C", config }).score).toBe(4);
    expect(scoreAnswer({ selectedOptionId: "A", correctOptionId: "C", config }).score).toBe(-1);
  });

  it("per-question points override the competition default", () => {
    expect(pointsForQuestion(3, DEFAULT_SCORING)).toBe(3);
    expect(pointsForQuestion(null, DEFAULT_SCORING)).toBe(1);
    expect(scoreAnswer({ selectedOptionId: "D", correctOptionId: "D", questionPoints: 5, config: DEFAULT_SCORING }).score).toBe(5);
  });
});

describe("streaks (participation only)", () => {
  it("counts consecutive answered days", () => {
    expect(computeStreaks({ answeredDays: [1, 2, 3], currentDay: 3, todayOpen: true })).toEqual({ currentStreak: 3, longestStreak: 3 });
  });

  it("a missed day resets the current streak but keeps the longest", () => {
    expect(computeStreaks({ answeredDays: [1, 2, 3], currentDay: 5, todayOpen: true })).toEqual({ currentStreak: 0, longestStreak: 3 });
  });

  it("today's still-open question doesn't break the streak", () => {
    expect(computeStreaks({ answeredDays: [1, 2, 3, 4], currentDay: 5, todayOpen: true })).toEqual({ currentStreak: 4, longestStreak: 4 });
  });

  it("after the competition ends, an unanswered final day breaks it", () => {
    expect(computeStreaks({ answeredDays: [1, 2, 3, 4], currentDay: 5, todayOpen: false })).toEqual({ currentStreak: 0, longestStreak: 4 });
  });

  it("tracks the longest run in the middle", () => {
    expect(computeStreaks({ answeredDays: [1, 3, 4, 5, 6, 8], currentDay: 8, todayOpen: false })).toEqual({ currentStreak: 1, longestStreak: 4 });
  });
});

describe("participant stats aggregation", () => {
  const rec = (day: number, status: "ANSWERED" | "MISSED", isCorrect: boolean | null, score: number): AnswerRecord => ({
    dayNumber: day,
    status,
    isCorrect,
    score,
    answeredAt: status === "ANSWERED" ? new Date(2026, 9, day, 10) : null,
    responseTimeMs: status === "ANSWERED" ? day * 1000 : null,
  });

  it("derives totals and streaks from answer records", () => {
    const stats = computeParticipantStats(
      [rec(1, "ANSWERED", true, 1), rec(2, "ANSWERED", false, 0), rec(3, "MISSED", null, 0), rec(4, "ANSWERED", true, 1)],
      { phase: "ACTIVE", currentDay: 5, durationDays: 30 },
    );
    expect(stats).toMatchObject({
      totalScore: 2,
      correctAnswers: 2,
      wrongAnswers: 1,
      answeredDays: 3,
      missedDays: 1,
      currentStreak: 1,
      longestStreak: 2,
      totalResponseTimeMs: 7000,
    });
    expect(stats.lastAnsweredAt).toEqual(new Date(2026, 9, 4, 10));
  });
});
