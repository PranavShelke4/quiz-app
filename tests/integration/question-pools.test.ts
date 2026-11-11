import { describe, expect, it } from "vitest";
import { POST as createCompetitionRoute } from "@/app/api/admin/competitions/route";
import { DELETE as deleteQuestionRoute } from "@/app/api/admin/questions/[id]/route";
import { POST as importRoute } from "@/app/api/admin/questions/import/route";
import { POST as createQuestionRoute } from "@/app/api/admin/questions/route";
import { GET as quizStateRoute } from "@/app/api/competitions/current/question/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { pickForParticipant, variantIndexFor } from "@/lib/quiz/pools";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { call, createRunningCompetition, createUser, dayMiddle, joinComp, sessionCookieFor, setNow } from "../helpers/fixtures";

async function admin() {
  const a = await createUser({ role: "ADMIN" });
  return sessionCookieFor(a._id, "ADMIN");
}

async function draft(cookie: string) {
  const res = await call(createCompetitionRoute, {
    cookie,
    body: {
      name: `Pool Challenge ${Math.random().toString(36).slice(2, 6)}`,
      startLocalDate: "2033-02-01",
      timezone: "Asia/Kolkata",
      durationDays: 3,
      scoring: { pointsPerCorrectAnswer: 1, negativeMarking: false, negativePoints: 0 },
      tieBreakers: [],
      leaderboardRevealMode: "AUTOMATIC",
      registrationOpen: true,
    },
  });
  return String(res.json.data.id);
}

describe("Question pools", () => {
  it("assigns versions stably and spreads people across them", () => {
    const base = { competitionId: "c1", dayNumber: 2, count: 3 };
    expect(variantIndexFor({ ...base, userId: "u1" })).toBe(variantIndexFor({ ...base, userId: "u1" }));
    const spread = new Set(Array.from({ length: 30 }, (_, i) => variantIndexFor({ ...base, userId: `u${i}` })));
    expect(spread.size).toBe(3);
    expect(pickForParticipant([], { competitionId: "c", dayNumber: 1, userId: "u" })).toBeUndefined();
  });

  it("imports several rows for one day as versions, and adding a question to a used day creates another version", async () => {
    const cookie = await admin();
    const competitionId = await draft(cookie);
    const csv = ["dayNumber,question,optionA,optionB,correctOption", "1,Version one?,a,b,A", "1,Version two?,c,d,B", "2,Only one?,e,f,A"].join("\n");
    const res = await call(importRoute, { cookie, body: { competitionId, csv, dryRun: false } });
    expect(res.json.data).toMatchObject({ validRows: 3, imported: 3 });
    expect((await Question.find({ competitionId, dayNumber: 1 }).sort({ variant: 1 }).lean()).map((q) => [q.variant, q.questionText])).toEqual([
      [1, "Version one?"],
      [2, "Version two?"],
    ]);

    const added = await call(createQuestionRoute, { cookie, body: { competitionId, dayNumber: 1, questionText: "Version three?", options: [{ id: "A", text: "x" }, { id: "B", text: "y" }], correctOptionIds: ["A"] } });
    expect(added.status).toBe(200);
    expect(added.json.data.variant).toBe(3);

    // Deleting a version renumbers the rest.
    const v1 = (await Question.findOne({ competitionId, dayNumber: 1, variant: 1 }).lean())!;
    await call(deleteQuestionRoute, { cookie, method: "DELETE", params: { id: String(v1._id) } });
    expect((await Question.find({ competitionId, dayNumber: 1 }).sort({ variant: 1 }).lean()).map((q) => [q.variant, q.questionText])).toEqual([
      [1, "Version two?"],
      [2, "Version three?"],
    ]);

    // Re-importing without overwrite is refused; with overwrite it replaces every version of the day.
    const again = await call(importRoute, { cookie, body: { competitionId, csv: "dayNumber,question,optionA,optionB,correctOption\n1,Replacement?,a,b,A", dryRun: true } });
    expect(again.json.data.errorRows).toBe(1);
    await call(importRoute, { cookie, body: { competitionId, csv: "dayNumber,question,optionA,optionB,correctOption\n1,Replacement?,a,b,A", dryRun: false, overwrite: true } });
    expect((await Question.find({ competitionId, dayNumber: 1 }).lean()).map((q) => q.questionText)).toEqual(["Replacement?"]);
  });

  it("shows each participant their own version and scores them against it", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    // Day 1 gets a second version whose correct answer is D (the fixture's version 1 has A).
    const v1 = (await Question.findOne({ competitionId: comp._id, dayNumber: 1 }).lean())!;
    await Question.create({ ...v1, _id: undefined, variant: 2, questionText: "Second version for day 1?", correctOptionId: "D", correctOptionIds: ["D"] });
    const versions = await Question.find({ competitionId: comp._id, dayNumber: 1 }).sort({ variant: 1 }).lean();

    setNow(dayMiddle(comp, 1));
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const u = await createUser();
      await joinComp(comp, u._id);
      const cookie = await sessionCookieFor(u._id);
      const state = await call(quizStateRoute, { cookie });
      const shown = state.json.data.today.question;
      const expected = pickForParticipant(versions, { competitionId: String(comp._id), dayNumber: 1, userId: String(u._id) })!;
      expect(shown.id).toBe(String(expected._id));
      seen.add(shown.id);
      // Answer with this version's correct option: always correct, and recorded against this version.
      const res = await call(submitRoute, { cookie, body: { optionId: expected.correctOptionId, questionId: shown.id } });
      expect(res.status).toBe(200);
      expect(await DailyAnswer.findOne({ userId: u._id }).lean()).toMatchObject({ isCorrect: true, questionId: expected._id });
    }
    expect(seen.size).toBe(2); // 12 people → both versions used
  });
});
