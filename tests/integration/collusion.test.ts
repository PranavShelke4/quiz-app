import type { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import type { OptionId } from "@/lib/validation/quiz";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { SuspicionFlag } from "@/models/SuspicionFlag";
import { detectSameWrongAnswers } from "@/services/anticheat.service";
import { correctFor, createRunningCompetition, createUser } from "../helpers/fixtures";

/** Wrong options for day d: the three letters that aren't correct. */
const wrongs = (d: number) => (["A", "B", "C", "D"] as const).filter((x) => x !== correctFor(d));

async function answer(compId: Types.ObjectId, userId: Types.ObjectId, day: number, option: OptionId) {
  const q = (await Question.findOne({ competitionId: compId, dayNumber: day }).lean())!;
  await DailyAnswer.create({
    competitionId: compId,
    userId,
    dayNumber: day,
    questionId: q._id,
    selectedOptionId: option,
    selectedOptionIds: [option],
    isCorrect: option === correctFor(day),
    score: option === correctFor(day) ? 1 : 0,
    status: "ANSWERED",
    answeredAt: new Date(),
  });
}

describe("Same-wrong-answers (collusion) detection", () => {
  it("flags a pair that keeps sharing a rare wrong answer, but not people sharing a popular one", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -10, durationDays: 5 });
    const [ann, bob, pairC, pairD] = [await createUser({ name: "Ann" }), await createUser({ name: "Bob" }), await createUser(), await createUser()];
    const crowd = await Promise.all(Array.from({ length: 12 }, () => createUser()));

    for (let day = 1; day <= 4; day++) {
      const [popular, rare, other] = wrongs(day) as [OptionId, OptionId, OptionId];
      // Ann & Bob: the same rare wrong answer every day.
      await answer(comp._id, ann._id, day, rare);
      await answer(comp._id, bob._id, day, rare);
      // The crowd: half correct, half the same popular wrong answer (a hard question).
      for (const [i, u] of crowd.entries()) await answer(comp._id, u._id, day, i % 2 ? popular : correctFor(day));
      // C & D only match on two days — not enough.
      await answer(comp._id, pairC._id, day, day <= 2 ? other : correctFor(day));
      await answer(comp._id, pairD._id, day, day <= 2 ? other : popular);
    }

    const raised = await detectSameWrongAnswers(comp, 4);
    expect(raised).toBe(2);
    const annFlag = await SuspicionFlag.findOne({ userId: ann._id, type: "SAME_WRONG_ANSWERS" }).lean();
    expect(annFlag?.details).toEqual({ partners: [{ userId: String(bob._id), name: "Bob", days: [1, 2, 3, 4] }] });
    expect(await SuspicionFlag.exists({ userId: bob._id, type: "SAME_WRONG_ANSWERS" })).toBeTruthy();
    expect(await SuspicionFlag.countDocuments({ userId: { $in: [...crowd.map((u) => u._id), pairC._id, pairD._id] } })).toBe(0);

    // Re-running refreshes evidence without duplicating flags; reviewed flags are left alone.
    await SuspicionFlag.updateOne({ userId: bob._id }, { $set: { status: "DISMISSED" } });
    expect(await detectSameWrongAnswers(comp, 4)).toBe(0);
    expect(await SuspicionFlag.countDocuments({ type: "SAME_WRONG_ANSWERS" })).toBe(2);
    expect((await SuspicionFlag.findOne({ userId: bob._id }).lean())!.status).toBe("DISMISSED");
  });
});
