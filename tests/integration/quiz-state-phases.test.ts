import { describe, expect, it } from "vitest";
import { GET as quizStateRoute } from "@/app/api/competitions/current/question/route";
import { call, createRunningCompetition, createUser, joinComp, sessionCookieFor } from "../helpers/fixtures";

describe("Quiz state outside the active window", () => {
  it("returns no 'today' (instead of crashing) before the competition starts", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: 3, durationDays: 2 });
    const player = await createUser();
    const cookie = await sessionCookieFor(player._id);

    const before = await call(quizStateRoute, { cookie });
    expect(before.status).toBe(200);
    expect(before.json.data).toMatchObject({ today: null, isParticipant: false });
    // Counts down to the first question's opening time on day 1.
    expect(Date.parse(before.json.data.nextQuestionAt)).toBeGreaterThanOrEqual(comp.startDate.getTime());

    await joinComp(comp, player._id);
    const joined = await call(quizStateRoute, { cookie });
    expect(joined.status).toBe(200);
    expect(joined.json.data).toMatchObject({ today: null, isParticipant: true });
  });
});
