import { describe, expect, it } from "vitest";
import { PATCH as updateCompetitionRoute } from "@/app/api/admin/competitions/[id]/route";
import { GET as quizStateRoute } from "@/app/api/competitions/current/question/route";
import { GET as questionForDayRoute } from "@/app/api/questions/[day]/route";
import { POST as eventRoute } from "@/app/api/quiz/attempt/event/route";
import { POST as startRoute } from "@/app/api/quiz/attempt/start/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { ANTICHEAT_DEFAULTS, minimumPlausibleAnswerMs, type AntiCheatSettings } from "@/lib/quiz/anticheat-config";
import { Competition, type ICompetition } from "@/models/Competition";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { QuizAttempt } from "@/models/QuizAttempt";
import { SuspicionFlag } from "@/models/SuspicionFlag";
import { call, correctFor, createRunningCompetition, createUser, dayMiddle, joinComp, sessionCookieFor, setNow } from "../helpers/fixtures";

async function timedCompetition(overrides: Partial<AntiCheatSettings> = {}) {
  const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
  const antiCheat = { ...ANTICHEAT_DEFAULTS, timeLimitSeconds: 30, ...overrides };
  await Competition.updateOne({ _id: comp._id }, { $set: { antiCheat } });
  return (await Competition.findById(comp._id).lean()) as ICompetition;
}

async function player(comp: ICompetition) {
  const user = await createUser();
  await joinComp(comp, user._id);
  return { user, cookie: await sessionCookieFor(user._id) };
}

/** The display letter this participant sees for the real correct option of day 1. */
async function correctDisplayId(comp: ICompetition, options: { id: string; text: string }[]) {
  const q = (await Question.findOne({ competitionId: comp._id, dayNumber: 1 }).lean())!;
  const correctText = q.options.find((o) => o.id === correctFor(1))!.text;
  return options.find((o) => o.text === correctText)!.id;
}

describe("Anti-cheat: timed attempts", () => {
  it("hides the question until Start, then scores an answer given in the participant's own option letters", async () => {
    const comp = await timedCompetition();
    const { user, cookie } = await player(comp);
    setNow(dayMiddle(comp, 1));

    const ready = await call(quizStateRoute, { cookie });
    expect(ready.json.data.today.status).toBe("READY");
    expect(ready.json.data.today).not.toHaveProperty("question");
    expect(ready.text).not.toContain("Question for day 1");
    expect((await call(questionForDayRoute, { cookie, params: { day: "1" } })).json.error?.code).toBe("ATTEMPT_REQUIRED");
    expect((await call(submitRoute, { cookie, body: { optionId: "A" } })).json.error?.code).toBe("ATTEMPT_REQUIRED");

    const started = await call(startRoute, { cookie, body: {} });
    expect(started.status).toBe(200);
    const { question, deadlineAt } = started.json.data;
    expect(question.options.map((o: { id: string }) => o.id)).toEqual(["A", "B", "C", "D"]);
    expect(Date.parse(deadlineAt) - Date.parse(started.json.data.serverTime)).toBeLessThanOrEqual(30_000);

    const pick = await correctDisplayId(comp, question.options);
    const res = await call(submitRoute, { cookie, body: { optionId: pick } });
    expect(res.status).toBe(200);
    expect(res.json.data.selectedOptionId).toBe(pick); // echoed in display letters
    expect(await DailyAnswer.findOne({ userId: user._id }).lean()).toMatchObject({ isCorrect: true, selectedOptionId: correctFor(1) });
    expect((await QuizAttempt.findOne({ userId: user._id }).lean())!.status).toBe("SUBMITTED");
  });

  it("rejects an answer after the time limit and records the day as missed", async () => {
    const comp = await timedCompetition();
    const { user, cookie } = await player(comp);
    const t0 = dayMiddle(comp, 1);
    setNow(t0);
    await call(startRoute, { cookie, body: {} });
    setNow(new Date(t0.getTime() + 35_000));
    const late = await call(submitRoute, { cookie, body: { optionId: "A" } });
    expect(late.json.error?.code).toBe("QUESTION_EXPIRED");
    expect(await DailyAnswer.findOne({ userId: user._id }).lean()).toMatchObject({ status: "MISSED", score: 0 });
    expect((await call(quizStateRoute, { cookie })).json.data.today).toMatchObject({ status: "ENDED", reason: "TIME_UP" });
    expect(await SuspicionFlag.exists({ userId: user._id })).toBeFalsy(); // running out of time isn't suspicious
  });

  it("locks the attempt when the participant leaves the page, and flags it with the evidence", async () => {
    const comp = await timedCompetition();
    const { user, cookie } = await player(comp);
    setNow(dayMiddle(comp, 1));
    await call(startRoute, { cookie, body: {} });

    const info = await call(eventRoute, { cookie, body: { type: "COPY_ATTEMPT" } });
    expect(info.json.data.status).toBe("STARTED"); // copy attempts are recorded, not punished

    const left = await call(eventRoute, { cookie, body: { type: "VISIBILITY_HIDDEN" } });
    expect(left.json.data).toEqual({ status: "LOCKED", lockReason: "LEFT_PAGE" });
    expect((await call(submitRoute, { cookie, body: { optionId: "A" } })).json.error?.code).toBe("ATTEMPT_LOCKED");
    expect(await DailyAnswer.findOne({ userId: user._id }).lean()).toMatchObject({ status: "MISSED" });
    const flag = await SuspicionFlag.findOne({ userId: user._id }).lean();
    expect(flag).toMatchObject({ type: "ATTEMPT_LOCKED", details: { reason: "LEFT_PAGE", events: { COPY_ATTEMPT: 1, VISIBILITY_HIDDEN: 1 } } });
    expect((await call(quizStateRoute, { cookie })).json.data.today).toMatchObject({ status: "ENDED", reason: "LEFT_PAGE" });
  });

  it("treats reloading the quiz page during an attempt as leaving", async () => {
    const comp = await timedCompetition();
    const { cookie } = await player(comp);
    setNow(dayMiddle(comp, 1));
    await call(startRoute, { cookie, body: {} });
    const reloaded = await call(quizStateRoute, { cookie });
    expect(reloaded.json.data.today).toMatchObject({ status: "ENDED", reason: "RELOADED" });
  });

  it("ends the attempt when it's opened on a second device", async () => {
    const comp = await timedCompetition();
    const { user, cookie } = await player(comp);
    const otherDevice = await sessionCookieFor(user._id);
    setNow(dayMiddle(comp, 1));
    await call(startRoute, { cookie, body: {} });
    const second = await call(startRoute, { cookie: otherDevice, body: {} });
    expect(second.json.error?.code).toBe("ATTEMPT_LOCKED");
    expect((await QuizAttempt.findOne({ userId: user._id }).lean())!.lockReason).toBe("SECOND_DEVICE");
    expect((await call(submitRoute, { cookie, body: { optionId: "A" } })).status).toBeGreaterThanOrEqual(400);
  });

  it("with lock-on-leave off: leaving is only recorded and a reload resumes the same attempt", async () => {
    const comp = await timedCompetition({ lockOnLeave: false, shuffleOptions: false });
    const { user, cookie } = await player(comp);
    setNow(dayMiddle(comp, 1));
    await call(startRoute, { cookie, body: {} });
    expect((await call(eventRoute, { cookie, body: { type: "WINDOW_BLUR" } })).json.data.status).toBe("STARTED");
    const resumed = await call(quizStateRoute, { cookie });
    expect(resumed.json.data.today.status).toBe("IN_PROGRESS");
    expect(resumed.json.data.today.question.questionText).toBe("Question for day 1?");
    const res = await call(submitRoute, { cookie, body: { optionId: correctFor(1) } });
    expect(res.status).toBe(200);
    expect(await DailyAnswer.findOne({ userId: user._id }).lean()).toMatchObject({ isCorrect: true });
  });

  it("shuffles option order per participant", async () => {
    const comp = await timedCompetition();
    setNow(dayMiddle(comp, 1));
    const orders = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const { cookie } = await player(comp);
      const res = await call(startRoute, { cookie, body: {} });
      orders.add(res.json.data.question.options.map((o: { text: string }) => o.text).join("|"));
    }
    expect(orders.size).toBeGreaterThan(1); // 8 random orders of 4 options are virtually never all identical
  });

  it("flags a correct answer given faster than the question can be read — but not a slow one or a fast wrong one", async () => {
    const comp = await timedCompetition({ shuffleOptions: false });
    const q = (await Question.findOne({ competitionId: comp._id, dayNumber: 1 }).lean())!;
    const minimum = minimumPlausibleAnswerMs(q);
    const t0 = dayMiddle(comp, 1);

    const fast = await player(comp);
    setNow(t0);
    await call(startRoute, { cookie: fast.cookie, body: {} });
    setNow(new Date(t0.getTime() + 800));
    await call(submitRoute, { cookie: fast.cookie, body: { optionId: correctFor(1) } });
    const flag = await SuspicionFlag.findOne({ userId: fast.user._id, type: "FAST_ANSWER" }).lean();
    expect(flag?.details).toEqual({ responseMs: 800, minimumMs: minimum });
    expect(await DailyAnswer.findOne({ userId: fast.user._id }).lean()).toMatchObject({ isCorrect: true, score: 1 }); // score untouched

    const slow = await player(comp);
    setNow(t0);
    await call(startRoute, { cookie: slow.cookie, body: {} });
    setNow(new Date(t0.getTime() + minimum + 500));
    await call(submitRoute, { cookie: slow.cookie, body: { optionId: correctFor(1) } });
    expect(await SuspicionFlag.exists({ userId: slow.user._id })).toBeFalsy();

    const guess = await player(comp);
    setNow(t0);
    await call(startRoute, { cookie: guess.cookie, body: {} });
    setNow(new Date(t0.getTime() + 500));
    await call(submitRoute, { cookie: guess.cookie, body: { optionId: correctFor(1) === "A" ? "B" : "A" } });
    expect(await SuspicionFlag.exists({ userId: guess.user._id })).toBeFalsy();
  });

  it("doesn't flag fast answers when the setting is off", async () => {
    const comp = await timedCompetition({ shuffleOptions: false, flagFastAnswers: false });
    const { user, cookie } = await player(comp);
    const t0 = dayMiddle(comp, 1);
    setNow(t0);
    await call(startRoute, { cookie, body: {} });
    setNow(new Date(t0.getTime() + 300));
    await call(submitRoute, { cookie, body: { optionId: correctFor(1) } });
    expect(await SuspicionFlag.exists({ userId: user._id })).toBeFalsy();
  });

  it("lets an admin turn anti-cheat on for a running competition", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    const admin = await createUser({ role: "ADMIN" });
    const cookie = await sessionCookieFor(admin._id, "ADMIN");
    const res = await call(updateCompetitionRoute, { cookie, method: "PATCH", params: { id: String(comp._id) }, body: { antiCheat: { ...ANTICHEAT_DEFAULTS, timeLimitSeconds: 45 } } });
    expect(res.status).toBe(200);
    expect((await Competition.findById(comp._id).lean())!.antiCheat).toMatchObject({ enabled: true, timeLimitSeconds: 45 });
  });
});
