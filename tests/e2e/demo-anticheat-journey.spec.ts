import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_SECRETS } from "../../playwright.config";

/**
 * Demo competition, start to finish, with anti-cheat (timed attempts) switched on.
 *
 * One admin creates a 4-day "Demo Anti-Cheat Challenge" and three participants play it:
 *  - Alice (honest)   answers through the UI every day (3 right, 1 wrong) → 3 points, rank 1.
 *  - Bob (cheater)    switches tab (day 1), reloads (day 2), opens a second device (day 3),
 *                     then tampers with the API on day 4 (forged score, bad option, replays,
 *                     too-fast answer) → only his one real correct answer counts → 1 point.
 *  - Carol (slow)     lets the timer run out (day 1), pokes at past/future days, then skips → 0.
 *
 * Plus: question hidden until Start, no answer key in any payload, leaderboard/results locked
 * mid-competition, CSRF + unauthenticated requests refused, admin sees and reviews the flags,
 * and the final leaderboard + per-day results are revealed with the correct answers.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TZ = "Asia/Kolkata";
const STAMP = Date.now();

// Same admin as competition-flow.spec.ts, so either spec can create it first.
const ADMIN = { name: "E2E Admin", email: "e2e-admin@example.com", password: "E2e!AdminPass1" };
const ALICE = { name: "Alice Honest", email: `alice-${STAMP}@example.com`, password: "Demo!Player#1" };
const BOB = { name: "Bob Cheater", email: `bob-${STAMP}@example.com`, password: "Demo!Player#2" };
const CAROL = { name: "Carol Slow", email: `carol-${STAMP}@example.com`, password: "Demo!Player#3" };

const Q = {
  1: { text: "Which planet is known as the Red Planet?", right: ["Mars"], wrong: "Venus", key: "B" },
  2: { text: "What is the capital city of Japan?", right: ["Tokyo"], wrong: "Seoul", key: "C" },
  3: { text: "Which gas do plants absorb from the air for photosynthesis?", right: ["Carbon dioxide"], wrong: "Oxygen", key: "C" },
  4: { text: "Select all the prime numbers in this list.", right: ["2", "7"], wrong: "4", key: "A, C" },
} as const;

const CSV = [
  "dayNumber,question,optionA,optionB,optionC,optionD,correctOption,category,difficulty,points,explanation",
  `1,${Q[1].text},Venus,Mars,Jupiter,Mercury,B,Science,EASY,,Iron oxide dust makes Mars look red.`,
  `2,${Q[2].text},Seoul,Beijing,Tokyo,Bangkok,C,Geography,EASY,,Tokyo has been Japan's capital since 1868.`,
  `3,${Q[3].text},Oxygen,Nitrogen,Carbon dioxide,Helium,C,Science,MEDIUM,,Plants take in CO2 and release oxygen.`,
  `4,${Q[4].text},2,4,7,9,A;C,Mathematics,MEDIUM,,2 and 7 have no divisors other than 1 and themselves.`,
].join("\n");

let BASE = "";
const json = (data: unknown) => ({ data, headers: { origin: BASE } });
async function errorCode(res: { json(): Promise<unknown> }) {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

async function setClock(request: APIRequestContext, at: number) {
  const res = await request.post("/api/test/clock", { data: { setIso: new Date(at).toISOString() } });
  expect(res.ok()).toBeTruthy();
}
async function advanceClock(request: APIRequestContext, ms: number) {
  const res = await request.post("/api/test/clock", { data: { advanceMs: ms } });
  expect(res.ok()).toBeTruthy();
}
async function runCron(request: APIRequestContext) {
  const res = await request.post("/api/cron/run", { headers: { authorization: `Bearer ${E2E_SECRETS.cron}` } });
  expect(res.ok()).toBeTruthy();
}

async function newUserContext(browser: Browser, user: { name: string; email: string; password: string }, mode: "signup" | "login") {
  const ctx = await browser.newContext({ baseURL: BASE });
  const res =
    mode === "signup"
      ? await ctx.request.post("/api/auth/signup", json({ ...user, acceptTerms: true }))
      : await ctx.request.post("/api/auth/login", json({ email: user.email, password: user.password }));
  expect(res.ok(), `${mode} ${user.email}: ${await res.text()}`).toBeTruthy();
  return ctx;
}

/** Press Start on the READY card and wait for the question to appear. */
async function startAttempt(page: Page, day: keyof typeof Q) {
  await page.goto("/quiz");
  await expect(page.getByText("Before you start")).toBeVisible();
  // Anti-cheat: the question text is not in the page before Start.
  expect(await page.content()).not.toContain(Q[day].text);
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByText(Q[day].text)).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
}

async function pick(page: Page, texts: readonly string[]) {
  for (const t of texts) await page.locator("label").filter({ has: page.getByText(t, { exact: true }) }).click();
}

const attemptEnded = (page: Page) => expect(page.getByRole("heading", { name: "Today's attempt has ended" })).toBeVisible();

test.describe.configure({ mode: "serial" });

test("demo competition: answers, results and every cheating path", async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The stateful journey runs once, on desktop.");
  BASE = testInfo.project.use.baseURL!;
  const contexts: BrowserContext[] = [];

  // ---------------------------------------------------------------- admin setup
  await setClock(request, Date.now());
  const setup = await request.post("/api/admin/setup", { data: { setupSecret: E2E_SECRETS.setup, ...ADMIN } });
  expect([200, 409]).toContain(setup.status());

  const admin = await browser.newContext({ baseURL: BASE });
  contexts.push(admin);
  expect((await admin.request.post("/api/admin/auth/login", json({ email: ADMIN.email, password: ADMIN.password }))).ok()).toBeTruthy();

  // Start 10 days from now (Kolkata) so it never overlaps the other E2E competition.
  const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const start = Date.parse(`${todayLocal}T00:00:00+05:30`) + 10 * DAY_MS; // local midnight of day 1
  const startLocal = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(start));
  const at = (day: number, hour: number) => start + (day - 1) * DAY_MS + hour * HOUR_MS;

  const created = await admin.request.post(
    "/api/admin/competitions",
    json({
      name: `Demo Anti-Cheat Challenge ${STAMP}`,
      description: "A 4-day demo competition with timed, locked-down attempts.",
      startLocalDate: startLocal,
      timezone: TZ,
      durationDays: 4,
      scoring: { pointsPerCorrectAnswer: 1, negativeMarking: false, negativePoints: 0 },
      tieBreakers: ["CORRECT_ANSWERS_DESC"],
      leaderboardRevealMode: "AUTOMATIC",
      registrationOpen: true,
      rules: [],
      antiCheat: { enabled: true, timeLimitSeconds: 30, shuffleOptions: true, lockOnLeave: true, watermark: true, requireFullscreen: false, flagFastAnswers: true },
    }),
  );
  expect(created.ok(), await created.text()).toBeTruthy();
  const competitionId = (await created.json()).data.id as string;

  const imported = await admin.request.post("/api/admin/questions/import", json({ competitionId, csv: CSV, dryRun: false, publish: true }));
  expect(imported.ok(), await imported.text()).toBeTruthy();
  const published = await admin.request.post(`/api/admin/competitions/${competitionId}/actions`, json({ action: "publish" }));
  expect(published.ok(), await published.text()).toBeTruthy();
  expect((await published.json()).data.status).toBe("SCHEDULED");

  // ---------------------------------------------------------------- participants
  // Alice signs up through the real form; Bob and Carol through the API.
  const alice = await browser.newContext({ baseURL: BASE });
  contexts.push(alice);
  const ap = await alice.newPage();
  await ap.goto("/signup");
  await ap.getByLabel("Name", { exact: true }).fill(ALICE.name);
  await ap.getByLabel("Email", { exact: true }).fill(ALICE.email);
  await ap.getByLabel("Password", { exact: true }).fill(ALICE.password);
  await ap.getByRole("checkbox").check();
  await ap.getByRole("button", { name: "Create account" }).click();
  await expect(ap).toHaveURL(/\/dashboard/);

  const bob = await newUserContext(browser, BOB, "signup");
  const carol = await newUserContext(browser, CAROL, "signup");
  contexts.push(bob, carol);
  const bp = await bob.newPage();
  const cp = await carol.newPage();

  // ================================================================ DAY 1 (10:00)
  await setClock(request, at(1, 10));

  // Not joined yet → the question is not shown at all.
  await ap.goto("/quiz");
  await expect(ap.getByText("Join to unlock today's question")).toBeVisible();
  expect(await ap.content()).not.toContain(Q[1].text);
  await ap.getByRole("button", { name: "Join the Competition" }).click();
  await expect(ap.getByText("Before you start")).toBeVisible();
  for (const ctx of [bob, carol]) expect((await ctx.request.post("/api/competitions/current/join", json({}))).ok()).toBeTruthy();

  // Cheat: read the question before pressing Start / submit without starting.
  expect(await errorCode(await bob.request.get("/api/questions/1"))).toBe("ATTEMPT_REQUIRED");
  expect(await errorCode(await bob.request.post("/api/quiz/submit", json({ optionId: "B" })))).toBe("ATTEMPT_REQUIRED");

  // Alice: honest correct answer through the UI (waits ~5 s "reading" so it isn't flagged as too fast).
  await startAttempt(ap, 1);
  await pick(ap, Q[1].right);
  await advanceClock(request, 5_000);
  await ap.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ap.getByText("Answer submitted", { exact: true })).toBeVisible();
  await expect(ap.getByText(/\bcorrect\b|\bincorrect\b|\bwrong\b/i)).toHaveCount(0); // correctness stays hidden
  await ap.reload();
  await expect(ap.getByText("Answer submitted", { exact: true })).toBeVisible();
  await expect(ap.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);
  // Cheat: submit again after answering.
  expect(await errorCode(await alice.request.post("/api/quiz/submit", json({ optionId: "A" })))).toBe("ANSWER_ALREADY_SUBMITTED");

  // Bob: switches to another tab/app mid-question → attempt ends as MISSED.
  await startAttempt(bp, 1);
  const eventSent = bp.waitForResponse((r) => r.url().includes("/api/quiz/attempt/event"));
  await bp.evaluate(() => window.dispatchEvent(new Event("blur")));
  await eventSent;
  await attemptEnded(bp);
  await expect(bp.getByText("You left the question page")).toBeVisible();
  // …and can't get back in or submit anyway.
  expect(await errorCode(await bob.request.post("/api/quiz/attempt/start", json({})))).toBe("ATTEMPT_LOCKED");
  expect(await errorCode(await bob.request.post("/api/quiz/submit", json({ optionId: "B" })))).toBe("ATTEMPT_LOCKED");

  // Carol: starts, then the 30 s limit passes before she submits.
  await startAttempt(cp, 1);
  await pick(cp, Q[1].right);
  await advanceClock(request, 45_000);
  await cp.getByRole("button", { name: "Submit Answer" }).click();
  await attemptEnded(cp);
  await expect(cp.getByText("The time limit ran out")).toBeVisible();

  // Locked mid-competition: leaderboard and results.
  expect(await errorCode(await alice.request.get("/api/leaderboard"))).toBe("LEADERBOARD_LOCKED");
  expect(await errorCode(await alice.request.get("/api/results"))).toBe("LEADERBOARD_LOCKED");
  await ap.goto("/leaderboard");
  await expect(ap.getByText("Leaderboard Locked")).toBeVisible();

  // Cheat: anonymous and cross-site (CSRF) submissions.
  expect(await errorCode(await request.post("/api/quiz/submit", { data: { optionId: "B" } }))).toBe("UNAUTHORIZED");
  const csrf = await alice.request.post("/api/quiz/submit", { data: { optionId: "B" }, headers: { origin: "https://evil.example" } });
  expect(csrf.status()).toBe(403);
  expect(await errorCode(csrf)).toBe("CSRF_FAILED");

  // After 18:00 the day is closed for everyone.
  await setClock(request, at(1, 19));
  expect(await errorCode(await carol.request.post("/api/quiz/attempt/start", json({})))).toBe("QUESTION_EXPIRED");
  await runCron(request);

  // ================================================================ DAY 2 (10:00)
  await setClock(request, at(2, 10));

  // Alice: copy and right-click are blocked on the question but don't end the attempt.
  await startAttempt(ap, 2);
  const copyBlocked = await ap.getByText(Q[2].text).evaluate((el) => {
    const ev = new Event("copy", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(copyBlocked).toBe(true);
  await ap.getByText(Q[2].text).click({ button: "right" });
  await expect(ap.getByRole("timer")).toBeVisible(); // still running
  await pick(ap, Q[2].right);
  await advanceClock(request, 5_000);
  await ap.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ap.getByText("Answer submitted", { exact: true })).toBeVisible();

  // Bob: reloads the page mid-question to try again → attempt ends.
  await startAttempt(bp, 2);
  await bp.reload();
  await attemptEnded(bp);
  expect(await errorCode(await bob.request.post("/api/quiz/submit", json({ optionId: "C" })))).toBe("ATTEMPT_LOCKED");

  // Carol: tries yesterday's and tomorrow's questions.
  expect(await errorCode(await carol.request.get("/api/questions/1"))).toBe("QUESTION_EXPIRED");
  expect(await errorCode(await carol.request.get("/api/questions/3"))).toBe("QUESTION_NOT_AVAILABLE");
  expect(await errorCode(await carol.request.post("/api/quiz/submit", json({ optionId: "B", dayNumber: 1 })))).toBe("QUESTION_EXPIRED");
  expect(await errorCode(await carol.request.post("/api/quiz/submit", json({ optionId: "C", dayNumber: 3 })))).toBe("QUESTION_NOT_AVAILABLE");
  await runCron(request);

  // ================================================================ DAY 3 (10:00)
  await setClock(request, at(3, 10));

  // Alice: answers wrong on purpose.
  await startAttempt(ap, 3);
  await pick(ap, [Q[3].wrong]);
  await advanceClock(request, 5_000);
  await ap.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ap.getByText("Answer submitted", { exact: true })).toBeVisible();
  await expect(ap.getByText(/\bcorrect\b|\bincorrect\b|\bwrong\b/i)).toHaveCount(0);

  // Bob: starts on his laptop, then opens the quiz on his phone (another session).
  await startAttempt(bp, 3);
  const bobPhone = await newUserContext(browser, BOB, "login");
  contexts.push(bobPhone);
  const phone = await bobPhone.newPage();
  await phone.goto("/quiz");
  await attemptEnded(phone);
  await expect(phone.getByText("opened on another device")).toBeVisible();
  // The laptop tab can't submit either.
  await pick(bp, Q[3].right);
  await bp.getByRole("button", { name: "Submit Answer" }).click();
  await attemptEnded(bp);
  await runCron(request);

  // ================================================================ DAY 4 (10:00)
  await setClock(request, at(4, 10));

  // Alice: multi-select question, both right options.
  await startAttempt(ap, 4);
  await expect(ap.getByText("Select all that apply.")).toBeVisible();
  await pick(ap, Q[4].right);
  await advanceClock(request, 5_000);
  await ap.getByRole("button", { name: "Submit Answer" }).click();
  await expect(ap.getByText("Answer submitted", { exact: true })).toBeVisible();

  // Bob: scripts the API directly.
  const startRes = await bob.request.post("/api/quiz/attempt/start", json({}));
  expect(startRes.ok()).toBeTruthy();
  const startBody = await startRes.text();
  // The answer key and explanation never reach the browser.
  expect(startBody).not.toMatch(/correctOption|explanation|isCorrect/);
  const started = JSON.parse(startBody).data as { question: { id: string; options: { id: string; text: string }[] } };
  const shown = (t: string) => started.question.options.find((o) => o.text === t)!.id;

  // Option that doesn't exist.
  expect(await errorCode(await bob.request.post("/api/quiz/submit", json({ optionIds: ["F"] })))).toBe("INVALID_OPTION");
  // Correct answer + forged fields: score/isCorrect/userId are stripped by the server.
  const forged = await bob.request.post(
    "/api/quiz/submit",
    json({ optionIds: Q[4].right.map(shown), questionId: started.question.id, score: 999, isCorrect: true, userId: "000000000000000000000000", points: 50 }),
  );
  expect(forged.ok(), await forged.text()).toBeTruthy();
  const forgedBody = (await forged.json()).data as Record<string, unknown>;
  expect(forgedBody).not.toHaveProperty("isCorrect");
  expect(forgedBody).not.toHaveProperty("score");
  // Replays, including a burst of parallel ones, are all refused.
  const burst = await Promise.all(Array.from({ length: 5 }, () => bob.request.post("/api/quiz/submit", json({ optionIds: Q[4].right.map(shown) }))));
  for (const r of burst) expect(await errorCode(r)).toBe("ANSWER_ALREADY_SUBMITTED");

  // ================================================================ END
  await setClock(request, at(5, 10));
  await runCron(request);

  // Admin sees the anti-cheat flags (signs in again: ADMIN sessions are short-lived and days have passed).
  expect((await admin.request.post("/api/admin/auth/login", json({ email: ADMIN.email, password: ADMIN.password }))).ok()).toBeTruthy();
  const flagsRes = await admin.request.get(`/api/admin/flags?competitionId=${competitionId}&pageSize=100`);
  expect(flagsRes.ok(), await flagsRes.text()).toBeTruthy();
  const flags = (await flagsRes.json()).data.items as { id: string; userEmail: string; type: string; dayNumber: number; details: { reason?: string } }[];
  const of = (email: string, type: string) => flags.filter((f) => f.userEmail === email && f.type === type).sort((a, b) => a.dayNumber - b.dayNumber);

  const bobLocks = of(BOB.email, "ATTEMPT_LOCKED");
  expect(bobLocks.map((f) => f.dayNumber)).toEqual([1, 2, 3]);
  expect(bobLocks[0]!.details.reason).toBe("LEFT_PAGE");
  expect(["RELOADED", "LEFT_PAGE"]).toContain(bobLocks[1]!.details.reason); // reload also fires pagehide
  expect(bobLocks[2]!.details.reason).toBe("SECOND_DEVICE");
  expect(of(BOB.email, "FAST_ANSWER").map((f) => f.dayNumber)).toEqual([4]);
  expect(of(ALICE.email, "ATTEMPT_LOCKED")).toHaveLength(0);
  expect(of(ALICE.email, "FAST_ANSWER")).toHaveLength(0);
  expect(of(CAROL.email, "ATTEMPT_LOCKED")).toHaveLength(0); // running out of time isn't cheating

  const adminPage = await admin.newPage();
  await adminPage.goto(`/admin/flags?competitionId=${competitionId}`);
  await expect(adminPage.getByRole("heading", { name: "Review flags" })).toBeVisible();
  await expect(adminPage.getByText(BOB.name).first()).toBeVisible();

  // Reviewing a flag doesn't change scores.
  const review = await admin.request.post("/api/admin/flags", json({ id: bobLocks[0]!.id, status: "CONFIRMED", note: "Demo: left the page on day 1." }));
  expect(review.ok(), await review.text()).toBeTruthy();

  // Final leaderboard.
  const lb = (await (await alice.request.get("/api/leaderboard")).json()).data as { entries: { name: string; rank: number; score: number; correct: number; wrong: number; missed: number }[] };
  const row = (name: string) => lb.entries.find((e) => e.name === name)!;
  expect(row(ALICE.name)).toMatchObject({ rank: 1, score: 3, correct: 3, wrong: 1, missed: 0 });
  expect(row(BOB.name)).toMatchObject({ rank: 2, score: 1, correct: 1, wrong: 0, missed: 3 });
  expect(row(CAROL.name)).toMatchObject({ rank: 3, score: 0, correct: 0, wrong: 0, missed: 4 });

  // Per-day results with the answer key.
  const results = (await (await alice.request.get("/api/results")).json()).data as { days: { dayNumber: number; result: string; points: number }[] };
  expect(results.days.map((d) => d.result)).toEqual(["CORRECT", "CORRECT", "WRONG", "CORRECT"]);
  const bobResults = (await (await bob.request.get("/api/results")).json()).data as { days: { result: string }[] };
  expect(bobResults.days.map((d) => d.result)).toEqual(["MISSED", "MISSED", "MISSED", "CORRECT"]);

  await ap.goto("/leaderboard");
  await expect(ap.getByRole("heading", { name: "Final Results" })).toBeVisible();
  await ap.goto("/results");
  await expect(ap.getByRole("heading", { name: "Your results" })).toBeVisible();
  await ap.goto("/results/3");
  await expect(ap.getByText(`Correct answer: Option ${Q[3].key}`)).toBeVisible();
  await expect(ap.getByText("Plants take in CO2 and release oxygen.")).toBeVisible();
  await ap.goto("/results/4");
  await expect(ap.getByText(`Correct answers: Options ${Q[4].key}`)).toBeVisible();
  await cp.goto("/results/2");
  await expect(cp.getByText("Missed · 0")).toBeVisible();

  // Answering after the end.
  expect(await errorCode(await carol.request.post("/api/quiz/submit", json({ optionId: "A" })))).toBe("COMPETITION_ENDED");

  await setClock(request, Date.now());
  for (const c of contexts) await c.close();
});
