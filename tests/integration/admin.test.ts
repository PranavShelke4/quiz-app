import { describe, expect, it } from "vitest";
import { POST as competitionActions } from "@/app/api/admin/competitions/[id]/actions/route";
import { PATCH as updateCompetitionRoute } from "@/app/api/admin/competitions/[id]/route";
import { POST as createCompetitionRoute } from "@/app/api/admin/competitions/route";
import { GET as exportAnswersRoute } from "@/app/api/admin/answers/export/route";
import { POST as leaderboardAction } from "@/app/api/admin/leaderboard/route";
import { POST as correctionRoute } from "@/app/api/admin/questions/[id]/correction/route";
import { PATCH as updateQuestionRoute } from "@/app/api/admin/questions/[id]/route";
import { POST as importRoute } from "@/app/api/admin/questions/import/route";
import { GET as leaderboardRoute } from "@/app/api/leaderboard/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { AnswerCorrection } from "@/models/AnswerCorrection";
import { AuditLog } from "@/models/AuditLog";
import { Competition } from "@/models/Competition";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { call, correctFor, createRunningCompetition, createUser, dayMiddle, sessionCookieFor, setNow, wrongFor } from "../helpers/fixtures";

async function adminCookie() {
  const admin = await createUser({ role: "ADMIN", name: "Admin" });
  return sessionCookieFor(admin._id, "ADMIN");
}

function csvFor(days: number[], extra = "") {
  const header = "dayNumber,question,optionA,optionB,optionC,optionD,correctOption,category,difficulty,points";
  return [header, ...days.map((d) => `${d},Question number ${d}?,Alpha ${d},Beta ${d},Gamma ${d},Delta ${d},B,Science,EASY,`), extra].filter(Boolean).join("\n");
}

describe("Admin: competition + question workflow", () => {
  it("creates a draft, imports questions all-or-nothing, and publishes", async () => {
    const cookie = await adminCookie();
    const created = await call(createCompetitionRoute, {
      cookie,
      body: {
        name: "October Daily Challenge",
        startLocalDate: "2030-10-01",
        timezone: "Asia/Kolkata",
        durationDays: 3,
        scoring: { pointsPerCorrectAnswer: 1, negativeMarking: false, negativePoints: 0 },
        tieBreakers: ["CORRECT_ANSWERS_DESC"],
        leaderboardRevealMode: "AUTOMATIC",
        registrationOpen: true,
        rules: [],
      },
    });
    expect(created.status).toBe(200);
    const id = created.json.data.id as string;
    expect(created.json.data).toMatchObject({ status: "DRAFT", startsAt: "2030-09-30T18:30:00.000Z", endsAt: "2030-10-03T18:30:00.000Z" });

    // Invalid file: nothing is imported.
    const bad = await call(importRoute, { cookie, body: { competitionId: id, csv: csvFor([1, 2], "9,Bad?,a,b,c,d,Z,,,"), dryRun: false } });
    expect(bad.json.error?.code).toBe("IMPORT_INVALID");
    expect(bad.json.error?.details).toMatchObject({ totalRows: 3, validRows: 2, errorRows: 1 });
    expect(await Question.countDocuments({ competitionId: id })).toBe(0);

    // Dry run then import.
    const dry = await call(importRoute, { cookie, body: { competitionId: id, csv: csvFor([1, 2, 3]), dryRun: true } });
    expect(dry.json.data).toMatchObject({ totalRows: 3, validRows: 3, errorRows: 0, imported: 0 });
    const real = await call(importRoute, { cookie, body: { competitionId: id, csv: csvFor([1, 2, 3]), dryRun: false, publish: true } });
    expect(real.json.data.imported).toBe(3);

    const publish = await call(competitionActions, { cookie, params: { id }, body: { action: "publish" } });
    expect(publish.json.data.status).toBe("SCHEDULED");
    expect(await AuditLog.countDocuments({ action: { $in: ["COMPETITION_CREATED", "QUESTIONS_IMPORTED", "COMPETITION_PUBLISHED"] } })).toBe(3);
  });

  it("refuses to publish with missing days and refuses dangerous edits after start", async () => {
    const cookie = await adminCookie();
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    const id = String(comp._id);
    const res = await call(updateCompetitionRoute, { cookie, method: "PATCH", params: { id }, body: { durationDays: 10 } });
    expect(res.json.error?.code).toBe("COMPETITION_LOCKED");
    const ok = await call(updateCompetitionRoute, { cookie, method: "PATCH", params: { id }, body: { name: "Renamed" } });
    expect(ok.json.data.name).toBe("Renamed");

    const opened = await Question.findOne({ competitionId: comp._id, dayNumber: 1 }).lean();
    const edit = await call(updateQuestionRoute, { cookie, method: "PATCH", params: { id: String(opened!._id) }, body: { correctOptionId: "D" } });
    expect(edit.json.error?.code).toBe("QUESTION_LOCKED");
  });

  it("controlled correction recalculates scores and records who/why/old/new", async () => {
    const cookie = await adminCookie();
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 3 });
    const player = await createUser();
    const pc = await sessionCookieFor(player._id);
    setNow(dayMiddle(comp, 1));
    await call(submitRoute, { cookie: pc, body: { optionId: wrongFor(1) } });
    expect((await CompetitionParticipant.findOne({ userId: player._id }).lean())!.totalScore).toBe(0);

    const q = await Question.findOne({ competitionId: comp._id, dayNumber: 1 }).lean();
    const res = await call(correctionRoute, {
      cookie,
      params: { id: String(q!._id) },
      body: { newCorrectOptionId: wrongFor(1), reason: "Option text was ambiguous; accepted answer updated." },
    });
    expect(res.json.data).toMatchObject({ affectedAnswers: 1, affectedParticipants: 1 });
    expect(await DailyAnswer.findOne({ userId: player._id, dayNumber: 1 }).lean()).toMatchObject({ isCorrect: true, score: 1 });
    expect((await CompetitionParticipant.findOne({ userId: player._id }).lean())!.totalScore).toBe(1);
    const record = await AnswerCorrection.findOne({ questionId: q!._id }).lean();
    expect(record).toMatchObject({ oldValue: { correctOptionId: correctFor(1) }, newValue: { correctOptionId: wrongFor(1) } });
    expect(await AuditLog.exists({ action: "ANSWER_CORRECTED" })).toBeTruthy();
  });

  it("manual reveal: hidden until an admin reveals after the end; hide/reveal are audited", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 2, revealMode: "MANUAL" });
    const player = await createUser();
    const pc = await sessionCookieFor(player._id);
    setNow(dayMiddle(comp, 1));
    await call(submitRoute, { cookie: pc, body: { optionId: correctFor(1) } });

    setNow(new Date(comp.endDate.getTime() + 5 * 60_000));
    expect((await call(leaderboardRoute, { cookie: pc })).json.error?.code).toBe("LEADERBOARD_LOCKED");
    expect((await Competition.findById(comp._id).lean())!.finalizedAt).toBeTruthy(); // frozen even before reveal

    // Admin sessions idle out after 2h, so sign the admin in at the (simulated) current time.
    const cookie = await adminCookie();
    await call(leaderboardAction, { cookie, body: { competitionId: String(comp._id), action: "reveal" } });
    const revealed = await call(leaderboardRoute, { cookie: pc });
    expect(revealed.json.data.me).toMatchObject({ rank: 1, score: 1, missed: 1 });

    await call(leaderboardAction, { cookie, body: { competitionId: String(comp._id), action: "hide" } });
    expect((await call(leaderboardRoute, { cookie: pc })).json.error?.code).toBe("LEADERBOARD_LOCKED");
    expect(await AuditLog.countDocuments({ action: { $in: ["LEADERBOARD_REVEALED", "LEADERBOARD_HIDDEN"] } })).toBe(2);
  });

  it("exports answers as CSV (server-side, permission checked, formula-safe)", async () => {
    const cookie = await adminCookie();
    const comp = await createRunningCompetition({ startOffsetDays: -1, durationDays: 2 });
    const player = await createUser({ name: "=cmd|' /C calc'!A0" });
    setNow(dayMiddle(comp, 2));
    await call(submitRoute, { cookie: await sessionCookieFor(player._id), body: { optionId: correctFor(2) } });
    const res = await call(exportAnswersRoute, { cookie, url: `/api/admin/answers/export?competitionId=${comp._id}` });
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.text).toContain("User,Email,Competition,Day");
    expect(res.text).toContain("'=cmd");
    expect(res.text).toContain("Correct");
  });
});
