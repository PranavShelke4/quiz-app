import { describe, expect, it } from "vitest";
import { GET as currentQuestionRoute } from "@/app/api/competitions/current/question/route";
import { POST as joinRoute } from "@/app/api/competitions/current/join/route";
import { GET as questionForDayRoute } from "@/app/api/questions/[day]/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { DailyAnswer } from "@/models/DailyAnswer";
import { call, correctFor, createRunningCompetition, createUser, dayMiddle, joinComp, sessionCookieFor, setNow } from "../helpers/fixtures";

/**
 * Questions and their options are only ever sent to participants. A signed-in
 * user who hasn't joined a competition sees a LOCKED state until they join.
 */
describe("Question access is limited to participants", () => {
  it("10 competitions, the user joined 3: only those 3 ever reveal their questions", async () => {
    // Ten back-to-back 2-day competitions, each starting two days after the previous one.
    const comps = [];
    for (let i = 0; i < 10; i++) comps.push(await createRunningCompetition({ startOffsetDays: 1 + i * 2, durationDays: 2 }));

    const user = await createUser({ name: "Pranav" });
    const joined = new Set([1, 4, 7]); // competitions #2, #5 and #8
    for (const i of joined) await joinComp(comps[i]!, user._id);

    // What the quiz page receives on Day 1 of each competition.
    const seen: { competition: number; status: string; question: string | null; options: number }[] = [];
    for (const [i, comp] of comps.entries()) {
      setNow(dayMiddle(comp, 1));
      const cookie = await sessionCookieFor(user._id);
      const res = await call(currentQuestionRoute, { cookie });
      expect(res.status).toBe(200);
      const { competition, today, isParticipant } = res.json.data;
      expect(competition.id).toBe(String(comp._id));
      expect(isParticipant).toBe(joined.has(i));

      seen.push({
        competition: i + 1,
        status: today.status,
        question: today.question?.questionText ?? null,
        options: today.question?.options.length ?? 0,
      });

      if (!joined.has(i)) {
        // Nothing about the question leaks into the payload.
        expect(res.text).not.toContain("Question for day");
        expect(res.text).not.toContain("Option A");
      }
    }

    expect(seen).toEqual([
      { competition: 1, status: "LOCKED", question: null, options: 0 },
      { competition: 2, status: "OPEN", question: "Question for day 1?", options: 4 },
      { competition: 3, status: "LOCKED", question: null, options: 0 },
      { competition: 4, status: "LOCKED", question: null, options: 0 },
      { competition: 5, status: "OPEN", question: "Question for day 1?", options: 4 },
      { competition: 6, status: "LOCKED", question: null, options: 0 },
      { competition: 7, status: "LOCKED", question: null, options: 0 },
      { competition: 8, status: "OPEN", question: "Question for day 1?", options: 4 },
      { competition: 9, status: "LOCKED", question: null, options: 0 },
      { competition: 10, status: "LOCKED", question: null, options: 0 },
    ]);
  });

  it("a non-participant can't fetch or answer the question through the API", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    const user = await createUser();
    setNow(dayMiddle(comp, 2));
    const cookie = await sessionCookieFor(user._id);

    const byDay = await call(questionForDayRoute, { cookie, params: { day: "2" } });
    expect(byDay.status).toBe(403);
    expect(byDay.json.error?.code).toBe("NOT_PARTICIPANT");
    expect(byDay.text).not.toContain("Question for day");

    const submit = await call(submitRoute, { cookie, body: { optionId: correctFor(2) } });
    expect(submit.json.error?.code).toBe("NOT_PARTICIPANT");
    expect(await DailyAnswer.countDocuments({ userId: user._id })).toBe(0);
  });

  it("joining unlocks today's question and options, and answering then works", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    const user = await createUser();
    setNow(dayMiddle(comp, 2));
    const cookie = await sessionCookieFor(user._id);

    const before = await call(currentQuestionRoute, { cookie });
    expect(before.json.data).toMatchObject({ isParticipant: false, canJoin: true, today: { status: "LOCKED", dayNumber: 2 } });
    expect(before.json.data.today.question).toBeUndefined();

    expect((await call(joinRoute, { cookie, body: {} })).status).toBe(200);

    const after = await call(currentQuestionRoute, { cookie });
    expect(after.json.data).toMatchObject({ isParticipant: true, today: { status: "OPEN", dayNumber: 2 } });
    expect(after.json.data.today.question.questionText).toBe("Question for day 2?");
    expect(after.json.data.today.question.options.map((o: { id: string }) => o.id)).toEqual(["A", "B", "C", "D"]);

    const byDay = await call(questionForDayRoute, { cookie, params: { day: "2" } });
    expect(byDay.json.data.questionText).toBe("Question for day 2?");

    const submit = await call(submitRoute, { cookie, body: { optionId: correctFor(2) } });
    expect(submit.json.data).toMatchObject({ status: "ANSWERED", dayNumber: 2 });
  });
});
