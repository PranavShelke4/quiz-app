import { describe, expect, it } from "vitest";
import { GET as getTodayRoute } from "@/app/api/competitions/current/question/route";
import { POST as cronRoute } from "@/app/api/cron/run/route";
import { GET as leaderboardRoute } from "@/app/api/leaderboard/route";
import { GET as questionByDayRoute } from "@/app/api/questions/[day]/route";
import { GET as progressRoute } from "@/app/api/quiz/progress/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { GET as resultsRoute } from "@/app/api/results/route";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Competition } from "@/models/Competition";
import { call, correctFor, createRunningCompetition, createUser, dayMiddle, joinComp, sessionCookieFor, setNow, wrongFor } from "../helpers/fixtures";

const CRON = { authorization: `Bearer ${process.env.CRON_SECRET}` };

async function setup(opts: Parameters<typeof createRunningCompetition>[0] = {}) {
  const comp = await createRunningCompetition({ startOffsetDays: -2, durationDays: 5, ...opts });
  const user = await createUser();
  await joinComp(comp, user._id);
  const cookie = await sessionCookieFor(user._id);
  return { comp, user, cookie };
}

describe("Business rules", () => {
  it("Case 1: correct answer → score 1, ANSWERED, but the user cannot see correctness", async () => {
    const { comp, user, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    const res = await call(submitRoute, { cookie, body: { optionId: correctFor(3) } });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ status: "ANSWERED", dayNumber: 3, selectedOptionId: correctFor(3) });
    expect(JSON.stringify(res.json)).not.toMatch(/isCorrect|score|correctOptionId|explanation|rank/i);

    const stored = await DailyAnswer.findOne({ userId: user._id, dayNumber: 3 }).lean();
    expect(stored).toMatchObject({ status: "ANSWERED", isCorrect: true, score: 1 });
    const participant = await CompetitionParticipant.findOne({ competitionId: comp._id, userId: user._id }).lean();
    expect(participant?.totalScore).toBe(1);
  });

  it("Case 2: wrong answer → score 0, ANSWERED, identical response shape", async () => {
    const { comp, user, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    const res = await call(submitRoute, { cookie, body: { optionId: wrongFor(3) } });
    expect(res.status).toBe(200);
    expect(Object.keys(res.json.data).sort()).toEqual(["dayNumber", "selectedOptionId", "status", "submittedAt"]);
    const stored = await DailyAnswer.findOne({ userId: user._id, dayNumber: 3 }).lean();
    expect(stored).toMatchObject({ status: "ANSWERED", isCorrect: false, score: 0 });
  });

  it("Case 3: an unanswered day becomes MISSED with 0 points via the cron rollover", async () => {
    const { comp, user, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    await call(submitRoute, { cookie, body: { optionId: correctFor(3) } }); // joins on day 3
    setNow(dayMiddle(comp, 5));
    const cron = await call(cronRoute, { method: "POST", headers: CRON });
    expect(cron.status).toBe(200);
    const day4 = await DailyAnswer.findOne({ userId: user._id, dayNumber: 4 }).lean();
    expect(day4).toMatchObject({ status: "MISSED", score: 0, selectedOptionId: null });
    const p = await CompetitionParticipant.findOne({ userId: user._id }).lean();
    expect(p).toMatchObject({ missedDays: 3, answeredDays: 1, currentStreak: 0, longestStreak: 1 }); // days 1,2 (joined late) + 4
  });

  it("Case 3b: missed days are repaired lazily even if cron never ran", async () => {
    const { comp, user, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    await call(submitRoute, { cookie, body: { optionId: correctFor(3) } });
    setNow(dayMiddle(comp, 5));
    const res = await call(progressRoute, { cookie });
    expect(res.json.data.progress.missed).toBe(3);
    expect(await DailyAnswer.countDocuments({ userId: user._id, status: "MISSED" })).toBe(3);
  });

  it("Case 4: submitting twice → ANSWER_ALREADY_SUBMITTED, first answer unchanged", async () => {
    const { comp, user, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    await call(submitRoute, { cookie, body: { optionId: "A" } });
    const second = await call(submitRoute, { cookie, body: { optionId: "B" } });
    expect(second.status).toBe(409);
    expect(second.json.error?.code).toBe("ANSWER_ALREADY_SUBMITTED");
    const stored = await DailyAnswer.find({ userId: user._id, dayNumber: 3 }).lean();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.selectedOptionId).toBe("A");
  });

  it("Case 4b: 10 simultaneous submissions produce exactly one answer", async () => {
    const { comp, user, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => call(submitRoute, { cookie, body: { optionId: (["A", "B", "C", "D"] as const)[i % 4] } })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.json.error?.code === "ANSWER_ALREADY_SUBMITTED")).toBe(true);
    expect(await DailyAnswer.countDocuments({ userId: user._id, dayNumber: 3 })).toBe(1);
    const p = await CompetitionParticipant.findOne({ userId: user._id }).lean();
    expect(p!.answeredDays).toBe(1);
  });

  it("Case 5: answering yesterday's question → QUESTION_EXPIRED", async () => {
    const { comp, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    const viaSubmit = await call(submitRoute, { cookie, body: { optionId: "A", dayNumber: 2 } });
    expect(viaSubmit.json.error?.code).toBe("QUESTION_EXPIRED");
    const viaGet = await call(questionByDayRoute, { cookie, params: { day: "2" } });
    expect(viaGet.status).toBe(410);
    expect(viaGet.json.error?.code).toBe("QUESTION_EXPIRED");
  });

  it("Case 5b: a missed day can never be answered later", async () => {
    const { comp, user, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    await call(submitRoute, { cookie, body: { optionId: "A" } });
    setNow(dayMiddle(comp, 4));
    const day3Again = await call(submitRoute, { cookie, body: { optionId: "B", dayNumber: 3 } });
    expect(day3Again.json.error?.code).toBe("QUESTION_EXPIRED");
    expect((await DailyAnswer.findOne({ userId: user._id, dayNumber: 3 }).lean())!.selectedOptionId).toBe("A");
  });

  it("Case 6: answering tomorrow's question → QUESTION_NOT_AVAILABLE", async () => {
    const { comp, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    const viaSubmit = await call(submitRoute, { cookie, body: { optionId: "A", dayNumber: 4 } });
    expect(viaSubmit.json.error?.code).toBe("QUESTION_NOT_AVAILABLE");
    for (const day of ["4", "tomorrow", "999"]) {
      const res = await call(questionByDayRoute, { cookie, params: { day } });
      expect(res.json.error?.code).toBe("QUESTION_NOT_AVAILABLE");
      expect(res.text).not.toContain("Question for day 4");
    }
  });

  it("Case 7: leaderboard during the competition → LEADERBOARD_LOCKED with no ranking data", async () => {
    const { comp, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    await call(submitRoute, { cookie, body: { optionId: correctFor(3) } });
    const res = await call(leaderboardRoute, { cookie });
    expect(res.status).toBe(403);
    expect(res.json.error?.code).toBe("LEADERBOARD_LOCKED");
    expect(res.json.error?.details).toMatchObject({ phase: "ACTIVE", daysRemaining: 2 });
    expect(res.text).not.toMatch(/rank|score|correct"/i);
    const results = await call(resultsRoute, { cookie });
    expect(results.json.error?.code).toBe("LEADERBOARD_LOCKED");
  });

  it("Case 8: after the competition ends the leaderboard and results become available", async () => {
    const { comp, user, cookie } = await setup({ startOffsetDays: -1, durationDays: 3 });
    const rival = await createUser({ name: "Rival" });
    await joinComp(comp, rival._id);
    const rivalCookie = await sessionCookieFor(rival._id);
    for (const day of [1, 2, 3]) {
      setNow(dayMiddle(comp, day));
      await call(submitRoute, { cookie, body: { optionId: correctFor(day) } });
      if (day !== 2) await call(submitRoute, { cookie: rivalCookie, body: { optionId: wrongFor(day) } });
    }
    setNow(new Date(comp.endDate.getTime() + 60_000));
    const freshCookie = await sessionCookieFor(user._id);
    const freshRivalCookie = await sessionCookieFor(rival._id);
    const res = await call(leaderboardRoute, { cookie: freshCookie });
    expect(res.status).toBe(200);
    expect(res.json.data.entries.map((e: { name: string; rank: number }) => [e.name, e.rank])).toEqual([["Test User", 1], ["Rival", 2]]);
    expect(res.json.data.me).toMatchObject({ rank: 1, score: 3, correct: 3, wrong: 0, missed: 0, isMe: true });
    // Emails are shown to signed-in participants on the leaderboard.
    expect(res.json.data.me.email).toMatch(/@example\.com$/);

    const stored = await Competition.findById(comp._id).lean();
    expect(stored).toMatchObject({ status: "COMPLETED", leaderboardRevealed: true });
    expect(stored!.finalizedAt).toBeTruthy();

    const results = await call(resultsRoute, { cookie: freshRivalCookie });
    expect(results.status).toBe(200);
    const days = results.json.data.days as { dayNumber: number; result: string; correctOptionId: string; explanation: string }[];
    expect(days.map((d) => d.result)).toEqual(["WRONG", "MISSED", "WRONG"]);
    expect(days[0]!.correctOptionId).toBe(correctFor(1));
    expect(days[0]!.explanation).toContain("Because");
    expect(results.json.data.summary).toMatchObject({ rank: 2, missed: 1, score: 0 });
    expect(user).toBeTruthy();
  });

  it("the user-facing question never contains the answer key", async () => {
    const { comp, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    const today = await call(getTodayRoute, { cookie });
    expect(today.json.data.today.status).toBe("OPEN");
    expect(today.json.data.today.question.options).toHaveLength(4);
    expect(today.text).not.toMatch(/correctOptionId|explanation|isCorrect|Because/);

    await call(submitRoute, { cookie, body: { optionId: wrongFor(3) } });
    const after = await call(getTodayRoute, { cookie });
    expect(after.json.data.today.status).toBe("ANSWERED");
    expect(after.text).not.toMatch(/correctOptionId|explanation|isCorrect|totalScore|"score"/);
  });

  it("progress exposes participation only — no score, correctness or rank", async () => {
    const { comp, cookie } = await setup();
    setNow(dayMiddle(comp, 3));
    await call(submitRoute, { cookie, body: { optionId: correctFor(3) } });
    const res = await call(progressRoute, { cookie });
    expect(res.json.data.progress).toMatchObject({ answered: 1, missed: 2, currentStreak: 1 });
    // The user-specific payload (not the public rules copy) must carry no scoring data.
    const userPayload = JSON.stringify({ progress: res.json.data.progress, isParticipant: res.json.data.isParticipant });
    expect(userPayload).not.toMatch(/score|correct|rank|wrong/i);
    expect(Object.keys(res.json.data).sort()).toEqual(["competition", "isParticipant", "progress"]);
  });

  it("submissions are rejected before the start and after the end", async () => {
    const { comp, cookie } = await setup({ startOffsetDays: 2 });
    const before = await call(submitRoute, { cookie, body: { optionId: "A" } });
    expect(before.json.error?.code).toBe("COMPETITION_NOT_STARTED");
    setNow(new Date(comp.endDate.getTime() + 1000));
    const after = await call(submitRoute, { cookie, body: { optionId: "A" } });
    expect(after.json.error?.code).toBe("COMPETITION_ENDED");
  });

  it("server time decides the day: an answer at 23:59:59 local counts for that day; 00:00 is the next day", async () => {
    const { comp, user, cookie } = await setup();
    const day3 = await import("@/lib/competition/schedule").then((m) => m.getDayWindow(comp, 3));
    setNow(new Date(day3.closesAt.getTime() - 1000));
    await call(submitRoute, { cookie, body: { optionId: "A", dayNumber: 3 } });
    setNow(new Date(day3.closesAt.getTime()));
    const late = await call(submitRoute, { cookie, body: { optionId: "A", dayNumber: 3 } });
    expect(late.json.error?.code).toBe("QUESTION_EXPIRED");
    expect(await DailyAnswer.countDocuments({ userId: user._id })).toBeGreaterThanOrEqual(1);
  });
});
