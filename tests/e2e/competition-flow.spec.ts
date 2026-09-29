import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_SECRETS } from "../../playwright.config";

/**
 * The Definition-of-Done scenario, end to end:
 * admin sets up a 3-day competition → user signs up, is verified, answers,
 * refreshes (answer persists), misses a day (MISSED, can't answer later),
 * competition ends → leaderboard + results revealed with correct answers.
 */

const DAY_MS = 86_400_000;
const ADMIN = { name: "E2E Admin", email: "e2e-admin@example.com", password: "E2e!AdminPass1" };
const USER = { name: "E2E Player", email: `e2e-player-${Date.now()}@example.com`, password: "E2e!PlayerPass1" };

const CSV = [
  "dayNumber,question,optionA,optionB,optionC,optionD,correctOption,category,difficulty,points,explanation",
  "1,Which planet is known as the Red Planet?,Venus,Mars,Jupiter,Mercury,B,Science,EASY,,Iron oxide makes Mars red.",
  "2,What is 2 + 2?,3,4,5,22,B,Mathematics,EASY,,Basic arithmetic.",
  "3,Which ocean is the largest?,Pacific,Atlantic,Indian,Arctic,A,Geography,EASY,,The Pacific covers a third of Earth.",
].join("\n");

async function kolkataToday(request: APIRequestContext) {
  const { data } = await (await request.get("/api/test/clock")).json();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(data.now));
}

async function setClock(request: APIRequestContext, iso: string) {
  const res = await request.post("/api/test/clock", { data: { setIso: iso } });
  expect(res.ok()).toBeTruthy();
}

async function runCron(request: APIRequestContext) {
  const res = await request.post("/api/cron/run", { headers: { authorization: `Bearer ${E2E_SECRETS.cron}` } });
  expect(res.ok()).toBeTruthy();
}

async function fill(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}

test.describe.configure({ mode: "serial" });

test("full 3-day competition journey", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The stateful journey runs once, on desktop.");

  // ---- Admin: bootstrap, sign in, create + import + publish -----------------
  await setClock(request, new Date().toISOString());
  const setup = await request.post("/api/admin/setup", { data: { setupSecret: E2E_SECRETS.setup, ...ADMIN } });
  expect([200, 409]).toContain(setup.status());

  await page.goto("/admin/login");
  await fill(page, "Email", ADMIN.email);
  await fill(page, "Password", ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const today = await kolkataToday(request);
  const start = new Date(Date.parse(`${today}T00:00:00+05:30`) + DAY_MS); // tomorrow, Kolkata
  const startLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(start);
  const created = await page.request.post("/api/admin/competitions", {
    data: {
      name: `E2E Challenge ${Date.now()}`,
      startLocalDate: startLocal,
      timezone: "Asia/Kolkata",
      durationDays: 3,
      scoring: { pointsPerCorrectAnswer: 1, negativeMarking: false, negativePoints: 0 },
      tieBreakers: ["CORRECT_ANSWERS_DESC"],
      leaderboardRevealMode: "AUTOMATIC",
      registrationOpen: true,
      rules: [],
    },
    headers: { origin: testInfo.project.use.baseURL! },
  });
  expect(created.ok()).toBeTruthy();
  const competitionId = (await created.json()).data.id as string;

  // CSV import through the UI.
  await page.goto(`/admin/questions?competitionId=${competitionId}&import=1`);
  await page.getByLabel("CSV content").fill(CSV);
  await page.getByLabel("Publish imported questions").check();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("3 rows detected")).toBeVisible();
  await page.getByRole("button", { name: /Import 3 rows/ }).click();
  await expect(page.getByText("3 of 3 days have a question")).toBeVisible();

  await page.goto(`/admin/competitions/${competitionId}`);
  await page.getByRole("button", { name: "Publish" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("SCHEDULED").first()).toBeVisible();

  // ---- User: sign up; admin verifies the email ------------------------------
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/signup");
  await fill(page, "Name", USER.name);
  await fill(page, "Email", USER.email);
  await fill(page, "Password", USER.password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Verify your email to compete")).toBeVisible();

  // Verification link goes to the console email provider; verify via the admin API instead.
  const adminCtx = await (await import("@playwright/test")).request.newContext({ baseURL: testInfo.project.use.baseURL });
  await adminCtx.post("/api/admin/auth/login", { data: { email: ADMIN.email, password: ADMIN.password }, headers: { origin: testInfo.project.use.baseURL! } });
  const users = await (await adminCtx.get(`/api/admin/users?search=${encodeURIComponent(USER.email)}`)).json();
  const userId = users.data.items[0].id as string;
  await adminCtx.post(`/api/admin/users/${userId}`, { data: { action: "verify-email" }, headers: { origin: testInfo.project.use.baseURL! } });

  // ---- Day 1: answer, refresh, still submitted -----------------------------
  await setClock(request, new Date(start.getTime() + 10 * 3_600_000).toISOString());
  await page.goto("/dashboard");
  await expect(page.getByText("Day 1 / 3").first()).toBeVisible();
  await page.goto("/quiz");
  await expect(page.getByText("Which planet is known as the Red Planet?")).toBeVisible();
  await page.getByText("Mars", { exact: true }).click();
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByText("Answer submitted", { exact: true })).toBeVisible();
  await expect(page.getByText(/correct|incorrect/i)).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Answer submitted", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Mars/ })).toBeDisabled();

  // Leaderboard is locked mid-competition.
  await page.goto("/leaderboard");
  await expect(page.getByText("Leaderboard Locked")).toBeVisible();

  // ---- Skip day 2 entirely; on day 3 it's MISSED and can't be answered -------
  await setClock(request, new Date(start.getTime() + 2 * DAY_MS + 10 * 3_600_000).toISOString());
  await runCron(request);
  await page.goto("/quiz");
  await expect(page.getByText("Which ocean is the largest?")).toBeVisible();
  await expect(page.getByText("Day 2: missed")).toBeAttached();
  const expired = await page.request.get("/api/questions/2");
  expect((await expired.json()).error.code).toBe("QUESTION_EXPIRED");
  const future = await page.request.get("/api/questions/tomorrow");
  expect((await future.json()).error.code).toBe("QUESTION_NOT_AVAILABLE");

  await page.getByText("Atlantic", { exact: true }).click(); // wrong on purpose
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByText("Answer submitted", { exact: true })).toBeVisible();

  // ---- Competition ends: leaderboard + results revealed ---------------------
  await setClock(request, new Date(start.getTime() + 3 * DAY_MS + 5 * 60_000).toISOString());
  await runCron(request);
  await page.goto("/leaderboard");
  await expect(page.getByRole("heading", { name: "Final Results" })).toBeVisible();
  await expect(page.getByText("#1").first()).toBeVisible();

  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await page.goto("/results/3");
  await expect(page.getByText("Correct answer: Option A")).toBeVisible();
  await expect(page.getByText("The Pacific covers a third of Earth.")).toBeVisible();
  await page.goto("/results/2");
  await expect(page.getByText("Missed · 0")).toBeVisible();

  await adminCtx.dispose();
  await setClock(request, new Date().toISOString());
});

test("public pages are usable without horizontal scrolling", async ({ page }) => {
  for (const path of ["/", "/rules", "/login", "/signup"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
  }
});

test("private pages redirect anonymous visitors to sign in", async ({ page }) => {
  await page.goto("/quiz");
  await expect(page).toHaveURL(/\/login\?next=%2Fquiz/);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/admin\/login/);
});
