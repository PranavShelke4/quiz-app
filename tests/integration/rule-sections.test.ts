import { describe, expect, it } from "vitest";
import { PATCH as updateCompetitionRoute } from "@/app/api/admin/competitions/[id]/route";
import { POST as createCompetitionRoute } from "@/app/api/admin/competitions/route";
import { Competition } from "@/models/Competition";
import { DEFAULT_RULE_SECTIONS, toPublicCompetition } from "@/services/competition.service";
import { call, createUser, sessionCookieFor } from "../helpers/fixtures";

async function adminCookie() {
  const admin = await createUser({ role: "ADMIN" });
  return sessionCookieFor(admin._id, "ADMIN");
}

const baseBody = {
  name: "Rules Challenge",
  startLocalDate: "2032-01-01",
  timezone: "Asia/Kolkata",
  durationDays: 3,
  scoring: { pointsPerCorrectAnswer: 1, negativeMarking: false, negativePoints: 0 },
  tieBreakers: [],
  leaderboardRevealMode: "AUTOMATIC",
  registrationOpen: true,
};

describe("Rule sections", () => {
  it("stores sections with title, description and rules, and mirrors them into the flat list", async () => {
    const cookie = await adminCookie();
    const ruleSections = [
      { title: "Scoring", description: "How points work.", rules: ["Easy = 1 point.", "Hard = 3 points."] },
      { title: "Fair play", description: "", rules: ["One account per person."] },
    ];
    const res = await call(createCompetitionRoute, { cookie, body: { ...baseBody, ruleSections } });
    expect(res.status).toBe(200);
    const comp = (await Competition.findById(res.json.data.id).lean())!;
    expect(comp.ruleSections).toEqual(ruleSections);
    expect(comp.rules).toEqual(["Easy = 1 point.", "Hard = 3 points.", "One account per person."]);
    expect(toPublicCompetition(comp).ruleSections).toEqual(ruleSections);
  });

  it("rejects a section without a title", async () => {
    const cookie = await adminCookie();
    const res = await call(createCompetitionRoute, { cookie, body: { ...baseBody, ruleSections: [{ title: " ", description: "", rules: ["x"] }] } });
    expect(res.status).toBe(400);
  });

  it("shows a legacy flat list as one section, keeps it on unrelated edits, and falls back to defaults when cleared", async () => {
    const cookie = await adminCookie();
    const res = await call(createCompetitionRoute, { cookie, body: { ...baseBody, rules: ["Old rule A", "Old rule B"] } });
    const id = res.json.data.id as string;
    let comp = (await Competition.findById(id).lean())!;
    expect(toPublicCompetition(comp).ruleSections).toEqual([{ title: "Rules", description: "", rules: ["Old rule A", "Old rule B"] }]);

    await call(updateCompetitionRoute, { cookie, method: "PATCH", params: { id }, body: { name: "Renamed Challenge" } });
    comp = (await Competition.findById(id).lean())!;
    expect(comp.rules).toEqual(["Old rule A", "Old rule B"]);

    await call(updateCompetitionRoute, { cookie, method: "PATCH", params: { id }, body: { ruleSections: [] } });
    comp = (await Competition.findById(id).lean())!;
    expect(comp.rules).toEqual([]);
    expect(toPublicCompetition(comp).ruleSections).toEqual(DEFAULT_RULE_SECTIONS);
  });
});
