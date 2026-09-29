import { describe, expect, it } from "vitest";
import { rankParticipants, type RankableParticipant } from "@/lib/leaderboard/ranking";

const p = (userId: string, o: Partial<RankableParticipant> = {}): RankableParticipant => ({
  userId,
  totalScore: 0,
  correctAnswers: 0,
  missedDays: 0,
  totalResponseTimeMs: 0,
  lastAnsweredAt: null,
  joinedAt: new Date("2026-10-01T00:00:00Z"),
  ...o,
});

describe("leaderboard ranking", () => {
  it("ranks by total score descending", () => {
    const r = rankParticipants([p("a", { totalScore: 3 }), p("b", { totalScore: 9 }), p("c", { totalScore: 5 })], []);
    expect(r.map((x) => [x.userId, x.rank])).toEqual([["b", 1], ["c", 2], ["a", 3]]);
  });

  it("breaks score ties by correct answers (negative marking can make these differ)", () => {
    const r = rankParticipants(
      [p("a", { totalScore: 5, correctAnswers: 6 }), p("b", { totalScore: 5, correctAnswers: 7 })],
      ["CORRECT_ANSWERS_DESC"],
    );
    expect(r.map((x) => x.userId)).toEqual(["b", "a"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2]);
  });

  it("then by total response time (faster ranks higher)", () => {
    const r = rankParticipants(
      [p("slow", { totalScore: 5, correctAnswers: 5, totalResponseTimeMs: 9000 }), p("fast", { totalScore: 5, correctAnswers: 5, totalResponseTimeMs: 1000 })],
      ["CORRECT_ANSWERS_DESC", "TOTAL_RESPONSE_TIME_ASC"],
    );
    expect(r.map((x) => [x.userId, x.rank])).toEqual([["fast", 1], ["slow", 2]]);
  });

  it("uses shared ranks for complete ties (1, 2, 2, 4) and a stable order", () => {
    const r = rankParticipants(
      [p("d", { totalScore: 1 }), p("c", { totalScore: 5 }), p("b", { totalScore: 5 }), p("a", { totalScore: 9 })],
      ["CORRECT_ANSWERS_DESC"],
    );
    expect(r.map((x) => [x.userId, x.rank])).toEqual([["a", 1], ["b", 2], ["c", 2], ["d", 4]]);
  });

  it("is deterministic regardless of input order", () => {
    const list = [p("x", { totalScore: 2 }), p("y", { totalScore: 2 }), p("z", { totalScore: 3 })];
    const a = rankParticipants(list, []);
    const b = rankParticipants([...list].reverse(), []);
    expect(a).toEqual(b);
  });

  it("supports earliest-final-answer and joined-at tie-breakers", () => {
    const r = rankParticipants(
      [
        p("late", { totalScore: 4, lastAnsweredAt: new Date("2026-10-30T10:00:00Z") }),
        p("early", { totalScore: 4, lastAnsweredAt: new Date("2026-10-30T08:00:00Z") }),
        p("never", { totalScore: 4, lastAnsweredAt: null }),
      ],
      ["LAST_ANSWER_AT_ASC"],
    );
    expect(r.map((x) => x.userId)).toEqual(["early", "late", "never"]);
  });
});
