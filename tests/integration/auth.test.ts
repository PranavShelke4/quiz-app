import { describe, expect, it } from "vitest";
import { POST as changePasswordRoute } from "@/app/api/auth/change-password/route";
import { POST as forgotRoute } from "@/app/api/auth/forgot-password/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as resetRoute } from "@/app/api/auth/reset-password/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { POST as verifyRoute } from "@/app/api/auth/verify-email/route";
import { POST as adminLoginRoute } from "@/app/api/admin/auth/login/route";
import { User } from "@/models/User";
import { Session } from "@/models/Session";
import { PASSWORD, call, cookieFromResponse, createUser, sentEmails } from "../helpers/fixtures";

const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

describe("Authentication", () => {
  it("signs up, stores only a hash, and issues an HTTP-only session cookie", async () => {
    const res = await call(signupRoute, { body: { name: "Pranav", email: "Pranav@Example.com", password: PASSWORD, acceptTerms: true } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const user = await User.findOne({ email: "pranav@example.com" }).select("+passwordHash").lean();
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user!.role).toBe("USER");
    expect(user!.isEmailVerified).toBe(false);
    expect(JSON.stringify(res.json)).not.toContain("passwordHash");
    // Only the SHA-256 of the token is stored.
    const raw = cookieFromResponse(res.headers)!.split("=")[1]!;
    expect(await Session.exists({ tokenHash: raw })).toBeNull();
  });

  it("rejects weak passwords and duplicate emails", async () => {
    const weak = await call(signupRoute, { body: { name: "A B", email: "a@example.com", password: "password", acceptTerms: true } });
    expect(weak.json.error?.code).toBe("VALIDATION_ERROR");
    await call(signupRoute, { body: { name: "A B", email: "dup@example.com", password: PASSWORD, acceptTerms: true } });
    const dup = await call(signupRoute, { body: { name: "A B", email: "dup@example.com", password: PASSWORD, acceptTerms: true } });
    expect(dup.json.error?.code).toBe("EMAIL_IN_USE");
  });

  it("verifies email with a one-time token", async () => {
    await call(signupRoute, { body: { name: "Ver Ify", email: "verify@example.com", password: PASSWORD, acceptTerms: true } });
    const token = tokenFrom(sentEmails.at(-1)!.text);
    expect((await call(verifyRoute, { body: { token } })).status).toBe(200);
    expect((await User.findOne({ email: "verify@example.com" }).lean())!.isEmailVerified).toBe(true);
    expect((await call(verifyRoute, { body: { token } })).json.error?.code).toBe("INVALID_TOKEN");
  });

  it("keeps the user signed in across requests (persistent session) until logout", async () => {
    const user = await createUser({ email: "persist@example.com" });
    const login = await call(loginRoute, { body: { email: "persist@example.com", password: PASSWORD } });
    const cookie = cookieFromResponse(login.headers)!;
    for (let i = 0; i < 3; i++) {
      const s = await call(sessionRoute, { cookie });
      expect(s.json.data).toMatchObject({ authenticated: true, user: { id: String(user._id) } });
    }
    const out = await call(logoutRoute, { cookie, body: {} });
    expect(out.headers.get("set-cookie")).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await call(sessionRoute, { cookie })).json.data.authenticated).toBe(false);
  });

  it("rejects wrong passwords with a generic error and locks after repeated failures", async () => {
    await createUser({ email: "lock@example.com" });
    const unknown = await call(loginRoute, { body: { email: "nobody@example.com", password: "Whatever1!" } });
    const wrong = await call(loginRoute, { body: { email: "lock@example.com", password: "Wrong!Pass123" } });
    expect(unknown.json.error?.code).toBe("INVALID_CREDENTIALS");
    expect(wrong.json.error?.message).toBe(unknown.json.error?.message);
    for (let i = 0; i < 4; i++) await call(loginRoute, { body: { email: "lock@example.com", password: "Wrong!Pass123" } });
    const locked = await call(loginRoute, { body: { email: "lock@example.com", password: PASSWORD } });
    expect(locked.status).toBe(423);
    expect(locked.json.error?.code).toBe("ACCOUNT_LOCKED");
  });

  it("rate limits login attempts per IP", async () => {
    let last;
    for (let i = 0; i < 32; i++) last = await call(loginRoute, { body: { email: `x${i}@example.com`, password: "Wrong!Pass123" } });
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).toBeTruthy();
  });

  it("blocks disabled users", async () => {
    await createUser({ email: "disabled@example.com", active: false });
    const res = await call(loginRoute, { body: { email: "disabled@example.com", password: PASSWORD } });
    expect(res.json.error?.code).toBe("USER_DISABLED");
  });

  it("password reset: no enumeration, one-time token, revokes all sessions", async () => {
    const user = await createUser({ email: "reset@example.com" });
    const login = await call(loginRoute, { body: { email: "reset@example.com", password: PASSWORD } });
    const oldCookie = cookieFromResponse(login.headers)!;

    const a = await call(forgotRoute, { body: { email: "reset@example.com" } });
    const b = await call(forgotRoute, { body: { email: "missing@example.com" } });
    expect(a.json).toEqual(b.json);
    expect(sentEmails).toHaveLength(1);

    const token = tokenFrom(sentEmails[0]!.text);
    const newPassword = "N3w!Password99";
    expect((await call(resetRoute, { body: { token, password: newPassword } })).status).toBe(200);
    expect((await call(resetRoute, { body: { token, password: newPassword } })).json.error?.code).toBe("INVALID_TOKEN");
    expect((await call(sessionRoute, { cookie: oldCookie })).json.data.authenticated).toBe(false);
    expect((await call(loginRoute, { body: { email: "reset@example.com", password: newPassword } })).status).toBe(200);
    expect(user).toBeTruthy();
  });

  it("change password rotates the session and signs out other devices", async () => {
    await createUser({ email: "change@example.com" });
    const deviceA = cookieFromResponse((await call(loginRoute, { body: { email: "change@example.com", password: PASSWORD } })).headers)!;
    const deviceB = cookieFromResponse((await call(loginRoute, { body: { email: "change@example.com", password: PASSWORD } })).headers)!;
    const res = await call(changePasswordRoute, { cookie: deviceA, body: { currentPassword: PASSWORD, newPassword: "An0ther!Pass77" } });
    const rotated = cookieFromResponse(res.headers)!;
    expect(rotated).not.toBe(deviceA);
    expect((await call(sessionRoute, { cookie: deviceB })).json.data.authenticated).toBe(false);
    expect((await call(sessionRoute, { cookie: rotated })).json.data.authenticated).toBe(true);
  });

  it("admin login refuses non-admins without revealing the password was right", async () => {
    await createUser({ email: "plain@example.com" });
    const res = await call(adminLoginRoute, { body: { email: "plain@example.com", password: PASSWORD } });
    expect(res.json.error?.code).toBe("INVALID_CREDENTIALS");
  });
});
