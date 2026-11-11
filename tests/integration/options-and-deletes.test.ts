import type { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { POST as createCompetitionRoute } from "@/app/api/admin/competitions/route";
import { POST as bulkDeleteQuestionsRoute } from "@/app/api/admin/questions/bulk-delete/route";
import { POST as correctionRoute } from "@/app/api/admin/questions/[id]/correction/route";
import { POST as importRoute } from "@/app/api/admin/questions/import/route";
import { POST as createQuestionRoute } from "@/app/api/admin/questions/route";
import { DELETE as deleteUserRoute, PATCH as updateUserRoute } from "@/app/api/admin/users/[id]/route";
import { POST as bulkDeleteUsersRoute } from "@/app/api/admin/users/bulk-delete/route";
import { GET as quizStateRoute } from "@/app/api/competitions/current/question/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { User } from "@/models/User";
import { call, createRunningCompetition, createUser, dayMiddle, joinComp, sessionCookieFor, setNow } from "../helpers/fixtures";

async function adminCookie() {
  const admin = await createUser({ role: "ADMIN", name: "Admin" });
  return { admin, cookie: await sessionCookieFor(admin._id, "ADMIN") };
}

async function draftCompetition(cookie: string, durationDays = 5) {
  const res = await call(createCompetitionRoute, {
    cookie,
    body: {
      name: `Options Challenge ${Math.random().toString(36).slice(2, 6)}`,
      startLocalDate: "2031-03-01",
      timezone: "Asia/Kolkata",
      durationDays,
      scoring: { pointsPerCorrectAnswer: 1, negativeMarking: false, negativePoints: 0 },
      tieBreakers: [],
      leaderboardRevealMode: "AUTOMATIC",
      registrationOpen: true,
    },
  });
  expect(res.status).toBe(200);
  return String(res.json.data.id);
}

/** Makes day 1 of a running competition a "select all that apply" question (A and C correct, 5 points). */
async function makeDayOneMulti(compId: Types.ObjectId) {
  await Question.updateOne(
    { competitionId: compId, dayNumber: 1 },
    { $set: { correctOptionId: "A", correctOptionIds: ["A", "C"], points: 5 } },
  );
}

describe("Questions: 2–6 options, multiple answers, custom points", () => {
  it("creates a two-option question and a multiple-answer question with custom points", async () => {
    const { cookie } = await adminCookie();
    const competitionId = await draftCompetition(cookie);

    const tf = await call(createQuestionRoute, {
      cookie,
      body: { competitionId, dayNumber: 1, questionText: "The Sun is a star.", options: [{ id: "A", text: "True" }, { id: "B", text: "False" }], correctOptionIds: ["A"], points: 2 },
    });
    expect(tf.status).toBe(200);

    const multi = await call(createQuestionRoute, {
      cookie,
      body: {
        competitionId,
        dayNumber: 2,
        questionText: "Which of these are in Europe?",
        options: [{ id: "A", text: "Spain" }, { id: "B", text: "Brazil" }, { id: "C", text: "Poland" }],
        correctOptionIds: ["C", "A"],
        points: 4,
      },
    });
    expect(multi.status).toBe(200);
    const stored = await Question.findOne({ competitionId, dayNumber: 2 }).lean();
    expect(stored).toMatchObject({ correctOptionId: "A", correctOptionIds: ["A", "C"], points: 4 });

    const badKey = await call(createQuestionRoute, {
      cookie,
      body: { competitionId, dayNumber: 3, questionText: "Bad key question?", options: [{ id: "A", text: "x" }, { id: "B", text: "y" }], correctOptionIds: ["C"] },
    });
    expect(badKey.status).toBe(400);
  });

  it("imports CSV with 2-option and multi-answer rows, and rows read from Excel", async () => {
    const { cookie } = await adminCookie();
    const competitionId = await draftCompetition(cookie);
    const csv = [
      "dayNumber,question,optionA,optionB,optionC,optionD,correctOption,points",
      "1,The Sun is a star.,True,False,,,A,2",
      "2,Which are in Europe?,Spain,Brazil,Poland,Kenya,A;C,3",
    ].join("\n");
    const dry = await call(importRoute, { cookie, body: { competitionId, csv, dryRun: true } });
    expect(dry.json.data).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0 });
    await call(importRoute, { cookie, body: { competitionId, csv, dryRun: false } });
    expect(await Question.findOne({ competitionId, dayNumber: 1 }).lean()).toMatchObject({ options: [{ id: "A" }, { id: "B" }], points: 2 });
    expect(await Question.findOne({ competitionId, dayNumber: 2 }).lean()).toMatchObject({ correctOptionIds: ["A", "C"] });

    // Excel files are read in the browser into rows keyed by their header cells.
    const records = [
      { dayNumber: "3", question: "Pick the primes", optionA: "2", optionB: "4", optionC: "5", correctOption: "A,C", category: "Math", difficulty: "", points: "", explanation: "" },
      { dayNumber: "4", question: "Gap in options", optionA: "x", optionB: "", optionC: "z", correctOption: "A" },
      { dayNumber: "5", question: "Key not an option", optionA: "x", optionB: "y", correctOption: "D" },
    ];
    const report = await call(importRoute, { cookie, body: { competitionId, records, dryRun: true } });
    expect(report.json.data).toMatchObject({ totalRows: 3, validRows: 1, errorRows: 2 });
  });

  it("accepts friendly spreadsheet headers (exact rows produced by the .xlsx reader)", async () => {
    const { cookie } = await adminCookie();
    const competitionId = await draftCompetition(cookie);
    const records = [
      { Day: "1", Question: "Is 0.1 + 0.2 about 0.3?", "Option A": "Yes", "Option B": "No", "Option C": "", "Correct Answer": "A", Difficulty: "easy", Score: "1", Explanation: "Floating point & rounding <ok>" },
      { Day: "2", Question: "Pick the even numbers", "Option A": "2", "Option B": "3", "Option C": "4", "Correct Answer": "A;C", Difficulty: "MEDIUM", Score: "2", Explanation: "" },
      { Day: "3", Question: "Ünïcödé — café?", "Option A": "Oui", "Option B": "Non", "Option C": "", "Correct Answer": "a", Difficulty: "HARD", Score: "3", Explanation: "" },
    ];
    const res = await call(importRoute, { cookie, body: { competitionId, records, dryRun: false } });
    expect(res.json.data).toMatchObject({ totalRows: 3, validRows: 3, imported: 3 });
    expect(await Question.findOne({ competitionId, dayNumber: 2 }).lean()).toMatchObject({ correctOptionIds: ["A", "C"], points: 2, difficulty: "MEDIUM" });
    expect(await Question.findOne({ competitionId, dayNumber: 3 }).lean()).toMatchObject({ questionText: "Ünïcödé — café?", points: 3, difficulty: "HARD" });

    // Missing required columns are reported up front, like for CSV.
    const missing = await call(importRoute, { cookie, body: { competitionId, records: [{ Question: "No day column here?", "Option A": "x", "Option B": "y" }], dryRun: true } });
    expect(missing.json.error?.message).toMatch(/dayNumber.*correctOption/);
  });

  it("scores a multiple-answer question all-or-nothing and tells participants it is multi-select", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    await makeDayOneMulti(comp._id);
    const [full, partial] = [await createUser(), await createUser()];
    await joinComp(comp, full._id);
    await joinComp(comp, partial._id);
    setNow(dayMiddle(comp, 1));

    const fc = await sessionCookieFor(full._id);
    const state = await call(quizStateRoute, { cookie: fc });
    expect(state.json.data.today.question.multiSelect).toBe(true);
    expect(state.json.data.today.question).not.toHaveProperty("correctOptionIds");

    const ok = await call(submitRoute, { cookie: fc, body: { optionIds: ["C", "A"] } });
    expect(ok.status).toBe(200);
    expect(ok.json.data.selectedOptionIds).toEqual(["A", "C"]);
    expect(await DailyAnswer.findOne({ userId: full._id }).lean()).toMatchObject({ isCorrect: true, score: 5 });

    await call(submitRoute, { cookie: await sessionCookieFor(partial._id), body: { optionIds: ["A"] } });
    expect(await DailyAnswer.findOne({ userId: partial._id }).lean()).toMatchObject({ isCorrect: false, score: 0 });
  });

  it("rejects several options on a single-answer question", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    const player = await createUser();
    await joinComp(comp, player._id);
    setNow(dayMiddle(comp, 1));
    const res = await call(submitRoute, { cookie: await sessionCookieFor(player._id), body: { optionIds: ["A", "B"] } });
    expect(res.status).toBe(400);
    expect(res.json.error?.code).toBe("INVALID_OPTION");
  });

  it("corrections can change a single answer into multiple answers and rescore", async () => {
    const { cookie } = await adminCookie();
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    const player = await createUser();
    await joinComp(comp, player._id);
    setNow(dayMiddle(comp, 1));
    // Day 1's correct answer is A; this player picks A and B.
    await Question.updateOne({ competitionId: comp._id, dayNumber: 1 }, { $set: { correctOptionIds: ["A", "B"] } });
    await call(submitRoute, { cookie: await sessionCookieFor(player._id), body: { optionIds: ["A", "B"] } });
    await Question.updateOne({ competitionId: comp._id, dayNumber: 1 }, { $set: { correctOptionIds: ["A"] } });
    const q = await Question.findOne({ competitionId: comp._id, dayNumber: 1 }).lean();
    const res = await call(correctionRoute, { cookie, params: { id: String(q!._id) }, body: { newCorrectOptionIds: ["B", "A"], reason: "Both A and B are acceptable answers." } });
    expect(res.status).toBe(200);
    expect(await DailyAnswer.findOne({ userId: player._id }).lean()).toMatchObject({ isCorrect: true, score: 1 });
  });
});

describe("Bulk deletes and user editing", () => {
  it("bulk-deletes questions of a draft competition, all-or-nothing", async () => {
    const { cookie } = await adminCookie();
    const competitionId = await draftCompetition(cookie);
    const csv = ["dayNumber,question,optionA,optionB,correctOption", "1,First question?,a,b,A", "2,Second question?,a,b,B", "3,Third question?,a,b,A"].join("\n");
    await call(importRoute, { cookie, body: { competitionId, csv, dryRun: false } });
    const qs = await Question.find({ competitionId }).sort({ dayNumber: 1 }).lean();

    const res = await call(bulkDeleteQuestionsRoute, { cookie, body: { competitionId, ids: [String(qs[0]!._id), String(qs[2]!._id)] } });
    expect(res.json.data).toEqual({ deleted: 2 });
    expect((await Question.find({ competitionId }).lean()).map((q) => q.dayNumber)).toEqual([2]);
  });

  it("refuses to bulk-delete questions of a published competition", async () => {
    const { cookie } = await adminCookie();
    const comp = await createRunningCompetition({ startOffsetDays: 3, durationDays: 2 });
    const qs = await Question.find({ competitionId: comp._id }).lean();
    const res = await call(bulkDeleteQuestionsRoute, { cookie, body: { competitionId: String(comp._id), ids: qs.map((q) => String(q._id)) } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await Question.countDocuments({ competitionId: comp._id })).toBe(2);
  });

  it("deletes a user with typed confirmation and cascades their data", async () => {
    const { cookie } = await adminCookie();
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    const player = await createUser({ email: "delete.me@example.com" });
    await joinComp(comp, player._id);
    setNow(dayMiddle(comp, 1));
    await call(submitRoute, { cookie: await sessionCookieFor(player._id), body: { optionId: "A" } });

    const wrong = await call(deleteUserRoute, { cookie, method: "DELETE", params: { id: String(player._id) }, body: { confirmEmail: "nope@example.com" } });
    expect(wrong.status).toBe(400);
    expect(await User.exists({ _id: player._id })).toBeTruthy();

    const ok = await call(deleteUserRoute, { cookie, method: "DELETE", params: { id: String(player._id) }, body: { confirmEmail: "DELETE.ME@example.com" } });
    expect(ok.status).toBe(200);
    expect(await User.exists({ _id: player._id })).toBeFalsy();
    expect(await DailyAnswer.exists({ userId: player._id })).toBeFalsy();
    expect(await CompetitionParticipant.exists({ userId: player._id })).toBeFalsy();
  });

  it("bulk-deletes users but skips admins and the caller", async () => {
    const { admin, cookie } = await adminCookie();
    const [u1, u2] = [await createUser(), await createUser()];
    const otherAdmin = await createUser({ role: "ADMIN" });
    const ids = [u1, u2, otherAdmin, admin].map((u) => String(u._id));

    const unconfirmed = await call(bulkDeleteUsersRoute, { cookie, body: { ids } });
    expect(unconfirmed.status).toBe(400);

    const res = await call(bulkDeleteUsersRoute, { cookie, body: { ids, confirm: "DELETE" } });
    expect(res.json.data).toEqual({ deleted: 2, skipped: 2 });
    expect(await User.countDocuments({ _id: { $in: [u1._id, u2._id] } })).toBe(0);
    expect(await User.exists({ _id: otherAdmin._id })).toBeTruthy();
    expect(await User.exists({ _id: admin._id })).toBeTruthy();
  });

  it("lets an admin edit a user's name, email and team, rejecting duplicate emails", async () => {
    const { cookie } = await adminCookie();
    const user = await createUser({ email: "old@example.com" });
    await createUser({ email: "taken@example.com" });

    const dup = await call(updateUserRoute, { cookie, method: "PATCH", params: { id: String(user._id) }, body: { email: "taken@example.com" } });
    expect(dup.status).toBe(409);

    const ok = await call(updateUserRoute, { cookie, method: "PATCH", params: { id: String(user._id) }, body: { name: "New Name", email: "New@Example.com", team: "Design" } });
    expect(ok.status).toBe(200);
    expect(await User.findById(user._id).lean()).toMatchObject({ name: "New Name", email: "new@example.com", team: "Design" });
  });
});
