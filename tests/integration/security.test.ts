import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as adminAnswersRoute } from "@/app/api/admin/answers/route";
import { GET as auditLogsRoute } from "@/app/api/admin/audit-logs/route";
import { POST as adminLeaderboardAction } from "@/app/api/admin/leaderboard/route";
import { PATCH as settingsRoute } from "@/app/api/admin/settings/route";
import { POST as userActionRoute } from "@/app/api/admin/users/[id]/route";
import { GET as adminUsersRoute } from "@/app/api/admin/users/route";
import { GET as cronRoute } from "@/app/api/cron/run/route";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { POST as submitRoute } from "@/app/api/quiz/submit/route";
import { GET as testClockRoute } from "@/app/api/test/clock/route";
import { AuditLog } from "@/models/AuditLog";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { User } from "@/models/User";
import { proxy } from "@/proxy";
import { PASSWORD, call, correctFor, createRunningCompetition, createUser, dayMiddle, joinComp, sessionCookieFor, setNow, wrongFor } from "../helpers/fixtures";

describe("API manipulation attacks", () => {
  async function running() {
    const comp = await createRunningCompetition({ startOffsetDays: -2, durationDays: 5 });
    const user = await createUser();
    const victim = await createUser({ name: "Victim" });
    await joinComp(comp, user._id);
    const cookie = await sessionCookieFor(user._id);
    setNow(dayMiddle(comp, 3));
    return { comp, user, victim, cookie };
  }

  it("Attack 1+2: client-sent score / isCorrect are ignored", async () => {
    const { user, cookie } = await running();
    const res = await call(submitRoute, { cookie, body: { optionId: wrongFor(3), score: 100, isCorrect: true, status: "ANSWERED" } });
    expect(res.status).toBe(200);
    const stored = await DailyAnswer.findOne({ userId: user._id, dayNumber: 3 }).lean();
    expect(stored).toMatchObject({ status: "ANSWERED", isCorrect: false, score: 0 });
    expect((await CompetitionParticipant.findOne({ userId: user._id }).lean())!.totalScore).toBe(0);
  });

  it("Attack 3: a userId in the body cannot submit for someone else", async () => {
    const { user, victim, cookie } = await running();
    await call(submitRoute, { cookie, body: { optionId: correctFor(3), userId: String(victim._id) } });
    expect(await DailyAnswer.countDocuments({ userId: victim._id })).toBe(0);
    expect(await DailyAnswer.countDocuments({ userId: user._id, status: "ANSWERED" })).toBe(1);
  });

  it("rejects NoSQL operator injection in the option", async () => {
    const { cookie } = await running();
    const res = await call(submitRoute, { cookie, body: { optionId: { $ne: "A" } } });
    expect(res.json.error?.code).toBe("VALIDATION_ERROR");
  });

  it("role escalation via signup body is impossible", async () => {
    await call(signupRoute, { body: { name: "Mallory", email: "mallory@example.com", password: PASSWORD, acceptTerms: true, role: "SUPER_ADMIN" } });
    expect((await User.findOne({ email: "mallory@example.com" }).lean())!.role).toBe("USER");
  });

  it("unauthenticated users cannot submit", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1 });
    setNow(dayMiddle(comp, 2));
    expect((await call(submitRoute, { body: { optionId: "A" } })).json.error?.code).toBe("UNAUTHORIZED");
  });

  it("Attack 8: client clock headers have no effect — only the server clock counts", async () => {
    const { comp, user, cookie } = await running();
    const res = await call(submitRoute, { cookie, body: { optionId: "A", dayNumber: 3 }, headers: { date: "Mon, 01 Jan 2035 00:00:00 GMT" } });
    expect(res.status).toBe(200);
    expect((await DailyAnswer.findOne({ userId: user._id, status: "ANSWERED" }).lean())!.dayNumber).toBe(3);
    expect(comp).toBeTruthy();
  });

  it("session cookies are rejected for a disabled account", async () => {
    const { user, cookie } = await running();
    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });
    expect((await call(submitRoute, { cookie, body: { optionId: "A" } })).json.error?.code).toBe("UNAUTHORIZED");
  });
});

describe("Authorization (admin APIs)", () => {
  it("normal users are forbidden from every admin API", async () => {
    const user = await createUser();
    const cookie = await sessionCookieFor(user._id);
    for (const route of [adminUsersRoute, adminAnswersRoute, auditLogsRoute]) {
      const res = await call(route, { cookie });
      expect(res.status).toBe(403);
    }
  });

  it("an admin's regular USER session cannot use admin APIs (admin login required)", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const res = await call(adminUsersRoute, { cookie: await sessionCookieFor(admin._id, "USER") });
    expect(res.status).toBe(403);
    const ok = await call(adminUsersRoute, { cookie: await sessionCookieFor(admin._id, "ADMIN") });
    expect(ok.status).toBe(200);
    expect(ok.text).not.toMatch(/passwordHash|argon2/);
  });

  it("ADMIN cannot read audit logs, change security settings or change roles; SUPER_ADMIN can", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const superAdmin = await createUser({ role: "SUPER_ADMIN" });
    const target = await createUser();
    const a = await sessionCookieFor(admin._id, "ADMIN");
    const s = await sessionCookieFor(superAdmin._id, "ADMIN");

    expect((await call(auditLogsRoute, { cookie: a })).status).toBe(403);
    expect((await call(settingsRoute, { cookie: a, method: "PATCH", body: { platform: { maintenanceMode: true } } })).status).toBe(403);
    expect((await call(userActionRoute, { cookie: a, params: { id: String(target._id) }, body: { action: "change-role", role: "ADMIN" } })).status).toBe(403);

    expect((await call(auditLogsRoute, { cookie: s })).status).toBe(200);
    expect((await call(userActionRoute, { cookie: s, params: { id: String(target._id) }, body: { action: "change-role", role: "ADMIN" } })).status).toBe(200);
    expect((await User.findById(target._id).lean())!.role).toBe("ADMIN");
  });

  it("the leaderboard can't be revealed while the competition is running", async () => {
    const comp = await createRunningCompetition({ startOffsetDays: -1 });
    const admin = await createUser({ role: "ADMIN" });
    const res = await call(adminLeaderboardAction, { cookie: await sessionCookieFor(admin._id, "ADMIN"), body: { competitionId: String(comp._id), action: "reveal" } });
    expect(res.json.error?.code).toBe("LEADERBOARD_NOT_AVAILABLE");
  });

  it("cron endpoints require the secret", async () => {
    expect((await call(cronRoute)).status).toBe(401);
    expect((await call(cronRoute, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await call(cronRoute, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).status).toBe(200);
  });

  it("the test clock is unavailable unless explicitly enabled", async () => {
    expect((await call(testClockRoute)).status).toBe(404);
  });

  it("audit logs are append-only", async () => {
    await AuditLog.create({ adminId: null, action: "SETTINGS_UPDATED" });
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(AuditLog.updateOne({}, { $set: { action: "ADMIN_LOGIN" } })).rejects.toThrow(/append-only/);
  });
});

describe("Proxy (CSRF, route guards)", () => {
  const req = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(new URL(url, "http://localhost:3000"), { method: init.method ?? "GET", headers: { host: "localhost:3000", ...init.headers } });

  it("rejects cross-origin state-changing API requests carrying a session cookie", async () => {
    const res = proxy(req("/api/quiz/submit", { method: "POST", headers: { origin: "https://evil.example", cookie: "qz_session=abc" } }));
    expect(res.status).toBe(403);
  });

  it("allows same-origin API posts", async () => {
    const res = proxy(req("/api/quiz/submit", { method: "POST", headers: { origin: "http://localhost:3000", cookie: "qz_session=abc" } }));
    expect(res.status).toBe(200);
  });

  it("redirects anonymous visitors away from private pages", async () => {
    const user = proxy(req("/quiz"));
    expect(user.status).toBe(307);
    expect(user.headers.get("location")).toContain("/login?next=%2Fquiz");
    const admin = proxy(req("/admin/users"));
    expect(admin.headers.get("location")).toContain("/admin/login");
  });

  it("marks private pages noindex", async () => {
    const res = proxy(req("/dashboard", { headers: { cookie: "qz_session=abc" } }));
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
});
