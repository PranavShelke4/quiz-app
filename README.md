# Daily Quiz — 30-day competition platform

One question a day, four options, one submission. Scores, correctness and ranks stay hidden until the
competition ends, then the leaderboard and every answer (with explanations) are revealed.

Next.js 16 (App Router, Route Handlers, `proxy.ts`) · TypeScript (strict) · MongoDB + Mongoose 9 ·
Zod 4 · Tailwind CSS 4 · Argon2id · Vitest · Playwright.

> **The core rule:** a participant can answer today's question once, but can't discover whether they
> were right until the competition is over. That's enforced in the database (unique index), the
> services (time-derived day windows, server-side scoring), the API (DTOs that never contain the
> answer key or scores before reveal) and the UI (neutral participation-only states).

---

## Quick start (local)

```bash
pnpm install
cp .env.example .env.local          # fill in MONGODB_URI, AUTH_SECRET, CRON_SECRET, ADMIN_SETUP_SECRET
pnpm seed --demo                    # super admin + 30-day competition + demo user (passwords printed once)
pnpm dev                            # http://localhost:3000   · admin: /admin/login
```

MongoDB **must be a replica set** (transactions). Options:

| Option | How |
| --- | --- |
| MongoDB Atlas | Paste the `mongodb+srv://…` URI. In **Network Access** allow your IP (or `0.0.0.0/0` for dev only). |
| Docker | `docker compose up -d` → `MONGODB_URI=mongodb://localhost:27017/?replicaSet=rs0&directConnection=true` |
| No Docker | `pnpm db:memory` (throwaway in-memory replica set; data is lost on exit) and use the printed URI. |

Useful env for local testing: `SEED_START_OFFSET_DAYS=-4` starts the seeded competition 4 days ago
(so you land on Day 5). `ENABLE_TEST_CLOCK=true` (dev only) exposes `/api/test/clock` to move the
server clock; it is hard-disabled in production.

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm seed [--demo]` | Idempotent seed (refuses to run in production) |
| `pnpm create-admin --email x@y.z --name "Ops" [--role SUPER_ADMIN]` | Create/promote an admin with a one-time password |
| `pnpm cron:run` | Run all scheduled jobs once, directly against the DB |
| `pnpm db:memory` | Local in-memory replica set |
| `pnpm test` / `test:unit` / `test:integration` | Vitest (integration uses an in-memory replica set) |
| `pnpm test:e2e` | Playwright full journey (own DB + dev server + test clock) |
| `pnpm lint` / `typecheck` | ESLint / tsc |

---

## Architecture

```
src/
  proxy.ts                 Next 16 "middleware": request id, CSRF origin check, body cap,
                           optimistic redirects, noindex. NOT the security boundary.
  app/
    (public)/              /, /rules, /privacy, /terms           (SEO metadata, OG/Twitter)
    (auth)/                /login, /signup, /reset-password
    (user)/                /dashboard, /quiz, /leaderboard, /results, /results/[day], /profile
    admin/login            separate admin sign-in (ADMIN session)
    admin/(panel)/         dashboard, competitions, questions, users, answers, flags,
                           leaderboard, analytics, audit-logs, settings
    api/                   Route Handlers (see "API")
  services/                ALL business logic (quiz, competition, participant, leaderboard,
                           question, user, auth, analytics, notification, anticheat, jobs, audit, settings)
  lib/
    api/handler.ts         apiRoute(): auth → RBAC → maintenance → rate limit → Zod → typed response,
                           error mapping, structured logs, session rotation
    auth/                  session.ts (DB sessions), dal.ts (Server Components), rbac.ts
    competition/schedule.ts  pure day/phase math (time-zone + DST safe)
    quiz/                  scoring, streaks, stats (pure)
    leaderboard/ranking.ts deterministic ranking + configurable tie-breakers (pure)
    time/                  clock (single source of "now"), Intl-based zone math
    security/              argon2, tokens, rate limiter, request metadata
    validation/            Zod schemas
  models/                  Mongoose schemas + indexes
scripts/                   seed, create-admin, run-cron, dev-memory-db
tests/unit | integration | e2e
```

**Design decisions**

- **Route Handlers for all mutations** (client components call `/api/*`); Server Components read
  through services directly. One mutation path, testable without a browser.
- **Time is derived, never trusted.** The current day, windows and end are computed from
  `startDate + durationDays + timezone` using the server clock. The stored `status` is kept in
  sync by cron and lazily, but no rule depends on it — a late cron can't open a hole.
- **Opaque DB sessions** (not JWTs) so logout, force-logout, role changes, password resets and
  global logout take effect immediately.
- **The DB is the source of truth.** Aggregates (`CompetitionParticipant`) are always rebuildable
  from `DailyAnswer` via `recalculateParticipantStats()`; final ranks are frozen at completion.
- No Cache Components: nearly every page is per-user. API responses are `no-store` + `Vary: Cookie`;
  private pages are `private, no-store`, so one user's quiz state can't be cached for another.

---

## Database schema (key fields)

| Collection | Purpose | Indexes |
| --- | --- | --- |
| `users` | name, email, passwordHash (`select:false`), role, team, isActive, lastLoginAt, lockout counters, sessionsInvalidatedAt | `email` unique; createdAt; role; isActive; team |
| `sessions` | tokenHash (SHA-256), userId, kind USER/ADMIN, expiresAt (sliding), absoluteExpiresAt, ip, UA | `tokenHash` unique; userId; TTL on expiresAt |
| `authtokens` | RESET_PASSWORD, tokenHash, expiresAt, usedAt | tokenHash unique; TTL |
| `competitions` | name, slug, description, startDate, endDate, durationDays, timezone, status, registration, scoring{points,negativeMarking,negativePoints}, tieBreakers, reveal mode/date/flags, rules, finalizedAt | `slug` unique; status+startDate; startDate+endDate |
| `questions` | competitionId, dayNumber, questionText, options[4]{id A–D,text}, correctOptionId, explanation, category, difficulty, points, status, scheduledDate | **competitionId+dayNumber unique**; competitionId+scheduledDate; competitionId+status |
| `dailyanswers` | competitionId, userId, dayNumber, questionId, selectedOptionId, isCorrect, score, status ANSWERED/MISSED, answeredAt, responseTimeMs, ip, UA, sessionId | **competitionId+userId+dayNumber unique**; competitionId+dayNumber+status; userId+competitionId; questionId; competitionId+ip+dayNumber |
| `competitionparticipants` | totals, correct/wrong/answered/missed, streaks, totalResponseTimeMs, lastAnsweredAt, final{Rank,Score,Correct,Wrong,Missed} | competitionId+userId unique; competitionId+finalRank; competitionId+totalScore |
| `auditlogs` | adminId, action, targetType/Id, metadata, ip, UA, createdAt — **append-only** (update/delete hooks throw; no API) | createdAt; adminId; action; target |
| `answercorrections` | who/why/old/new/affected counts | competitionId+createdAt; questionId |
| `suspicionflags` | MULTIPLE_ACCOUNTS / RAPID_SUBMISSIONS / SUSPICIOUS_ACTIVITY, status OPEN/DISMISSED/CONFIRMED | competitionId+userId+type+day unique |
| `notifications` | in-app notification, idempotent dedupeKey | dedupeKey unique; userId+createdAt; TTL 120d |
| `settings` | singleton: competition defaults, security, notifications, platform, globalSessionsInvalidatedAt | key unique |
| `ratelimits` | fixed-window counters (multi-instance safe) | key+window unique; TTL |

---

## Competition lifecycle & scoring

`DRAFT → (publish: every day has a published question, no overlap) → SCHEDULED → ACTIVE → COMPLETED → ARCHIVED`

- Day *N* opens at 00:00 and closes at 24:00 local time in the competition's zone (DST-correct).
- **Submission** (`POST /api/quiz/submit`, one transaction): resolve today from the server clock →
  load the published question → validate option → score (`question.points ?? pointsPerCorrectAnswer`;
  wrong = 0 or −negativePoints) → join if needed → insert `DailyAnswer` → rebuild participant stats.
  Duplicates are impossible: pre-check + unique index (concurrent requests get
  `ANSWER_ALREADY_SUBMITTED`; verified with 10 parallel submissions).
- **Missed days**: cron inserts `MISSED` (score 0) for every participant without a record, 2 minutes
  after the day closes (so a 23:59:59 submission always wins). The same logic runs lazily whenever a
  user opens the app, and a full scan runs at finalization, so a failed cron can't lose data.
  Late joiners get MISSED for already-closed days.
- **Completion**: after `endDate`, finalization rebuilds all stats, ranks with
  `totalScore DESC` then the configured tie-breakers (default: more correct answers, then lower total
  response time; full ties share a rank), and freezes `final*` fields.
- **Reveal**: automatic at `max(endDate, leaderboardRevealDate)` unless an admin has manually
  revealed/hidden (their decision wins). Revealing before the end is refused.
- **Corrections**: after a day opens its question is locked; admins issue a correction (reason
  required) which updates the key/points, rescores every affected answer, records old/new/who/why,
  writes an audit log and re-finalizes ranks if needed.

## Hiding correctness (enforced at every layer)

- `toUserQuestion()` whitelists fields — no `correctOptionId`, no `explanation`.
- The submit response is identical for right and wrong answers.
- Progress/dashboard DTOs include only answered/missed/streak — no score, correct count, or rank
  (these could otherwise be combined to infer correctness).
- `/api/leaderboard` and `/api/results` return `LEADERBOARD_LOCKED` until
  `ended && finalized && revealed`. `/api/questions/:day` returns `QUESTION_EXPIRED` for past days
  and `QUESTION_NOT_AVAILABLE` for future ones.
- UI never uses green/red before reveal; states use icons + text.

## Security

| Area | Implementation |
| --- | --- |
| Passwords | Argon2id (m=19 MiB, t=2); policy ≥10 chars, upper+lower, digit, symbol; timing-equalised unknown-email logins |
| Sessions | 256-bit random token in `HttpOnly; SameSite=Lax; Secure; __Host-` cookie (prod); only SHA-256 stored; sliding idle + absolute expiry; rotation every 24h with 60s grace; ADMIN sessions only via `/admin/login` (12h) |
| Invalidation | logout, force-logout, disable, role change, password change/reset, SUPER_ADMIN global logout |
| Brute force | per-IP login/signup limits; per-account lockout after N failures (settings) |
| CSRF | SameSite cookies + Origin/Sec-Fetch-Site check in `proxy.ts` for all cookie-bearing mutations |
| AuthZ | `apiRoute(access, {permission})` on every handler; RBAC USER / ADMIN / SUPER_ADMIN; `requireAdmin()` in every admin page; identity only from the session |
| Input | Zod on every body/query (unknown keys stripped: `score`, `isCorrect`, `userId`, `role` are ignored); primitive-only values + `strictQuery` → no NoSQL operator injection; regex-escaped search; body size caps |
| Output | DTO serializers only; `passwordHash` `select:false`; no stack traces or DB errors to clients (500 → `INTERNAL_ERROR` + requestId; DB outage → 503) |
| Headers | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS (prod) |
| Exports | server-generated, permission-checked, audited, CSV formula-injection neutralised |
| Anti-cheat | submission IP/UA/session stored; heuristics raise flags for human review only |
| Logs | structured JSON (requestId, userId, route, method, status, duration, errorCode); secrets redacted |

## API

All responses: `{ "success": true, "data": … }` or `{ "success": false, "error": { "code", "message", "details?" } }`.

User: `POST /api/auth/{signup,login,logout,reset-password,change-password}` ·
`GET /api/auth/session` · `GET /api/competitions/current[/status|/question]` · `POST /api/competitions/current/join` ·
`GET /api/questions/:day` · `POST /api/quiz/submit` · `GET /api/quiz/progress` · `GET /api/leaderboard` ·
`GET /api/results` · `GET|PATCH /api/profile` · `GET|POST /api/notifications`

Admin (ADMIN session + permission): `/api/admin/auth/login`, `/setup`, `/dashboard`, `/users[/:id][/export]`,
`/competitions[/:id][/actions]`, `/questions[/:id][/correction]`, `/questions/import`, `/questions/publish-all`,
`/answers[/export]`, `/leaderboard[/export]`, `/analytics`, `/audit-logs`, `/settings[/global-logout]`, `/flags`

Cron: `GET|POST /api/cron/run` with `Authorization: Bearer $CRON_SECRET`.

Error codes: see `src/lib/errors.ts` (e.g. `ANSWER_ALREADY_SUBMITTED`, `QUESTION_EXPIRED`,
`QUESTION_NOT_AVAILABLE`, `LEADERBOARD_LOCKED`, `COMPETITION_NOT_STARTED`, `RATE_LIMITED`, …).

## Scheduled jobs

`runScheduledJobs()` (idempotent; run every 5–15 min): status transitions → missed-day rollover →
finalize + automatic reveal (+ notifications) → daily/deadline/ending reminders → anti-cheat
heuristics. Triggers: GitHub Actions (`.github/workflows/cron.yml`, every 10 min — set repo secrets
`APP_URL` and `CRON_SECRET`), Vercel Cron (`vercel.json`, daily as a backstop — the Hobby plan limit),
any external scheduler via `curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/run`,
or `pnpm cron:run` from a crontab.

## Notifications and password resets

The app sends no email. Signup needs no verification: new accounts can join and answer straight away.
Reminders and results announcements are in-app notifications, each stored with a unique `dedupeKey`
so it is created at most once. A user who forgets their password asks an admin, who clicks
**Create reset link** on the user's admin page and shares the one-time link (valid 24 hours).

## Tests

- **Unit (51)**: day/deadline calculation incl. DST, scoring, streaks, stats, ranking + tie-breaks, CSV, validation, RBAC.
- **Integration (48)**, real route handlers + in-memory replica set: all 8 business-rule cases, 10-way
  concurrent submission, lazy missed repair, all 8 API attacks, role escalation, admin/SUPER_ADMIN
  boundaries, CSRF/proxy, cron secret, append-only audit, auth flows (lockout, rate limit, reset
  revokes sessions, rotation), import all-or-nothing, corrections, manual reveal/hide, CSV export.
- **E2E (Playwright)**: admin setup → CSV import → publish → signup → answer → refresh →
  locked leaderboard → missed day (can't answer later) → end → leaderboard + results with answers;
  plus mobile no-horizontal-scroll and route guards.

## Deployment (Vercel + Atlas)

1. Atlas: create a cluster (replica set by default), a DB user, and allow Vercel egress in Network
   Access (`0.0.0.0/0` with a strong password, or Vercel's static IPs on Enterprise).
2. Vercel: import the repo; set `MONGODB_URI`, `MONGODB_DB`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`,
   `CRON_SECRET` (Vercel Cron sends it automatically), `ADMIN_SETUP_SECRET`. Leave `ENABLE_TEST_CLOCK` unset.
3. Deploy, then create the first super admin once:
   `curl -X POST https://host/api/admin/setup -H 'Content-Type: application/json' -d '{"setupSecret":"…","name":"…","email":"…","password":"…"}'`
   (disabled automatically once a super admin exists). Remove `ADMIN_SETUP_SECRET` afterwards.
4. Self-hosting (`pnpm build && pnpm start`) works the same; set `TRUST_PROXY=true` behind a reverse
   proxy that sets `X-Forwarded-For`, and set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` for multi-instance.

## Future-proofing

Competitions, questions and participants are keyed by `competitionId` (multiple/overlapping-free
competitions, question pools, randomisation, teams can extend `CompetitionParticipant`);
notifications are channel-agnostic; tie-breakers, scoring and reveal are per-competition config;
prizes, badges and certificates can hang off frozen `final*` results.

Legal pages (`/privacy`, `/terms`) are placeholders and must be reviewed by counsel.
