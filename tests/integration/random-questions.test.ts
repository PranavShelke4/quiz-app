import { describe, expect, it } from "vitest";
import { POST as startRoute } from "@/app/api/quiz/attempt/start/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { ANTICHEAT_DEFAULTS } from "@/lib/quiz/anticheat-config";
import { Competition, type ICompetition } from "@/models/Competition";
import { QuizAttempt } from "@/models/QuizAttempt";
import { questionForParticipant } from "@/services/pool.service";
import { isQuestionLocked } from "@/services/question.service";
import { call, createRunningCompetition, createUser, dayMiddle, joinComp, sessionCookieFor, setNow } from "../helpers/fixtures";

async function randomCompetition(days = 6) {
  const comp = await createRunningCompetition({ startOffsetDays: 0, durationDays: days });
  await Competition.updateOne({ _id: comp._id }, { $set: { questionMode: "RANDOM", antiCheat: { ...ANTICHEAT_DEFAULTS, timeLimitSeconds: 30, lockOnLeave: false } } });
  return (await Competition.findById(comp._id).lean()) as ICompetition;
}

describe("Question mode RANDOM", () => {
  it("gives one participant a different, never-repeated question every day, stable on reload", async () => {
    const comp = await randomCompetition(6);
    const user = await createUser();
    await joinComp(comp, user._id);
    const seen: string[] = [];
    for (let day = 1; day <= 6; day++) {
      setNow(dayMiddle(comp, day));
      const cookie = await sessionCookieFor(user._id); // fresh session for the faked date
      const before = await questionForParticipant(comp, day, user._id);
      expect(String((await questionForParticipant(comp, day, user._id))!._id)).toBe(String(before!._id)); // stable
      const started = await call(startRoute, { cookie, body: {} });
      expect(started.status).toBe(200);
      const attempt = (await QuizAttempt.findOne({ userId: user._id, dayNumber: day }).lean())!;
      expect(String(attempt.questionId)).toBe(String(before!._id)); // Start serves what was previewed
      seen.push(String(attempt.questionId));
      await call(submitRoute, { cookie, body: { optionId: started.json.data.question.options[0].id } });
    }
    expect(new Set(seen).size).toBe(6); // never repeated
  });

  it("shuffles: different participants get different questions on the same day", async () => {
    const comp = await randomCompetition(6);
    setNow(dayMiddle(comp, 1));
    const picks = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const u = await createUser();
      await joinComp(comp, u._id);
      picks.add(String((await questionForParticipant(comp, 1, u._id))!._id));
    }
    expect(picks.size).toBeGreaterThan(2);
  });

  it("locks every question once the competition has started", async () => {
    const comp = await randomCompetition(6);
    setNow(dayMiddle(comp, 1));
    expect(isQuestionLocked(comp, 6)).toBe(true);
    expect(isQuestionLocked({ ...comp, questionMode: "DAILY" }, 6)).toBe(false);
  });
});
