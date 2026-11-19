import { describe, expect, it } from "vitest";
import { GET as quizStateRoute } from "@/app/api/competitions/current/question/route";
import { POST as eventRoute } from "@/app/api/quiz/attempt/event/route";
import { POST as startRoute } from "@/app/api/quiz/attempt/start/route";
import { POST as adminUserAction } from "@/app/api/admin/users/[id]/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { ANTICHEAT_DEFAULTS } from "@/lib/quiz/anticheat-config";
import { Competition, type ICompetition } from "@/models/Competition";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { QuizAttempt } from "@/models/QuizAttempt";
import { joinCompetition } from "@/services/participant.service";
import { call, correctFor, createRunningCompetition, createUser, dayMiddle, joinComp, sessionCookieFor, setNow } from "../helpers/fixtures";

/** Timed competition on day 3, with a participant who joined late (days 1-2 MISSED). */
async function lateJoiner() {
  const comp = await createRunningCompetition({ startOffsetDays: -2, durationDays: 4 });
  await Competition.updateOne({ _id: comp._id }, { $set: { antiCheat: { ...ANTICHEAT_DEFAULTS, timeLimitSeconds: 30 } } });
  const fresh = (await Competition.findById(comp._id).lean()) as ICompetition;
  setNow(dayMiddle(fresh, 3));
  const user = await createUser();
  await joinCompetition(fresh, user._id, { at: dayMiddle(fresh, 3) }); // late: days 1-2 become MISSED
  return { comp: fresh, user, cookie: await sessionCookieFor(user._id) };
}

async function correctDisplayId(comp: ICompetition, day: number, options: { id: string; text: string }[]) {
  const q = (await Question.findOne({ competitionId: comp._id, dayNumber: day }).lean())!;
  const correctText = q.options.find((o) => o.id === correctFor(day))!.text;
  return options.find((o) => o.text === correctText)!.id;
}

describe("Make-up days (operator re-opened a closed day for one participant)", () => {
  it("without a grant, closed days stay closed", async () => {
    const { cookie } = await lateJoiner();
    expect((await call(quizStateRoute, { cookie })).json.data.makeup).toBeNull();
    expect((await call(startRoute, { cookie, body: { dayNumber: 1 } })).json.error?.code).toBe("QUESTION_EXPIRED");
    expect((await call(submitRoute, { cookie, body: { optionId: "A", dayNumber: 1 } })).json.error?.code).toBe("QUESTION_EXPIRED");
  });

  it("lets the participant answer a granted day once, replacing its MISSED record", async () => {
    const { comp, user, cookie } = await lateJoiner();
    expect(await DailyAnswer.findOne({ userId: user._id, dayNumber: 1 }).lean()).toMatchObject({ status: "MISSED" });
    await CompetitionParticipant.updateOne({ competitionId: comp._id, userId: user._id }, { $set: { makeupDays: [1, 2] } });

    const state = (await call(quizStateRoute, { cookie })).json.data;
    expect(state.makeup).toMatchObject({ status: "READY", dayNumber: 1, remaining: 2 });
    expect(state.today.status).toBe("READY"); // today is unaffected

    const started = await call(startRoute, { cookie, body: { dayNumber: 1 } });
    expect(started.status).toBe(200);
    expect(started.json.data.question.dayNumber).toBe(1);
    const pick = await correctDisplayId(comp, 1, started.json.data.question.options);
    const res = await call(submitRoute, { cookie, body: { optionId: pick, dayNumber: 1 } });
    expect(res.status).toBe(200);

    expect(await DailyAnswer.findOne({ userId: user._id, dayNumber: 1 }).lean()).toMatchObject({ status: "ANSWERED", isCorrect: true });
    const p = (await CompetitionParticipant.findOne({ competitionId: comp._id, userId: user._id }).lean())!;
    expect(p.makeupDays).toEqual([2]);
    expect(p).toMatchObject({ correctAnswers: 1, missedDays: 1 });
    expect((await call(quizStateRoute, { cookie })).json.data.makeup).toMatchObject({ dayNumber: 2, remaining: 1 });
    // A used day can't be retried.
    expect((await call(startRoute, { cookie, body: { dayNumber: 1 } })).json.error?.code).toBe("QUESTION_EXPIRED");
  });

  it("applies lock-on-leave to a make-up attempt, and the day is then used up", async () => {
    const { comp, user, cookie } = await lateJoiner();
    await CompetitionParticipant.updateOne({ competitionId: comp._id, userId: user._id }, { $set: { makeupDays: [2] } });
    await call(startRoute, { cookie, body: { dayNumber: 2 } });
    const left = await call(eventRoute, { cookie, body: { type: "VISIBILITY_HIDDEN" } });
    expect(left.json.data).toEqual({ status: "LOCKED", lockReason: "LEFT_PAGE" });
    expect(await DailyAnswer.findOne({ userId: user._id, dayNumber: 2 }).lean()).toMatchObject({ status: "MISSED" });
    expect((await CompetitionParticipant.findOne({ competitionId: comp._id, userId: user._id }).lean())!.makeupDays).toEqual([]);
    expect((await call(quizStateRoute, { cookie })).json.data.makeup).toBeNull();
  });

  it("other participants can't use someone else's grant", async () => {
    const { comp, user } = await lateJoiner();
    await CompetitionParticipant.updateOne({ competitionId: comp._id, userId: user._id }, { $set: { makeupDays: [1] } });
    const other = await createUser();
    await joinComp(comp, other._id);
    const otherCookie = await sessionCookieFor(other._id);
    expect((await call(startRoute, { cookie: otherCookie, body: { dayNumber: 1 } })).json.error?.code).toBe("QUESTION_EXPIRED");
  });
});

describe("Admin: re-open a day for one user", () => {
  async function admin() {
    const a = await createUser({ role: "ADMIN", name: "Admin" });
    return sessionCookieFor(a._id, "ADMIN");
  }

  it("re-opens an earlier missed day as a catch-up, then the user answers it", async () => {
    const { comp, user, cookie } = await lateJoiner();
    const adminCookie = await admin();
    const res = await call(adminUserAction, { cookie: adminCookie, params: { id: String(user._id) }, body: { action: "reopen-day", competitionId: String(comp._id), dayNumber: 1 } });
    expect(res.json.data).toMatchObject({ ok: true, mode: "makeup" });
    expect((await call(quizStateRoute, { cookie })).json.data.makeup).toMatchObject({ dayNumber: 1 });
    // Withdraw works too.
    await call(adminUserAction, { cookie: adminCookie, params: { id: String(user._id) }, body: { action: "cancel-reopen", competitionId: String(comp._id), dayNumber: 1 } });
    expect((await call(quizStateRoute, { cookie })).json.data.makeup).toBeNull();
  });

  it("re-opening today clears a locked attempt so the user can start again", async () => {
    const { comp, user, cookie } = await lateJoiner();
    await call(startRoute, { cookie, body: {} });
    await call(eventRoute, { cookie, body: { type: "VISIBILITY_HIDDEN" } });
    expect((await call(quizStateRoute, { cookie })).json.data.today.status).toBe("ENDED");
    const res = await call(adminUserAction, { cookie: await admin(), params: { id: String(user._id) }, body: { action: "reopen-day", competitionId: String(comp._id), dayNumber: 3 } });
    expect(res.json.data).toMatchObject({ ok: true, mode: "today-reset" });
    expect(await QuizAttempt.exists({ userId: user._id, dayNumber: 3 })).toBeFalsy();
    expect((await call(quizStateRoute, { cookie })).json.data.today.status).toBe("READY");
  });

  it("refuses answered days and non-admins", async () => {
    const { comp, user, cookie } = await lateJoiner();
    const started = await call(startRoute, { cookie, body: {} });
    await call(submitRoute, { cookie, body: { optionId: started.json.data.question.options[0].id } });
    const body = { action: "reopen-day", competitionId: String(comp._id), dayNumber: 3 };
    expect((await call(adminUserAction, { cookie: await admin(), params: { id: String(user._id) }, body })).status).toBe(409);
    expect((await call(adminUserAction, { cookie, params: { id: String(user._id) }, body: { ...body, dayNumber: 1 } })).status).toBeGreaterThanOrEqual(401);
  });
});
