import { NextRequest } from "next/server";
import type { Types } from "mongoose";
import { vi } from "vitest";
import { createSession } from "@/lib/auth/session";
import { computeEndDate, computeStartDate, getDayWindow } from "@/lib/competition/schedule";
import { hashPassword } from "@/lib/security/password";
import { addDaysToLocalDate, localDateInZone } from "@/lib/time/zoned";
import type { OptionId } from "@/lib/validation/quiz";
import { Competition, type ICompetition } from "@/models/Competition";
import { Question } from "@/models/Question";
import { User, type Role } from "@/models/User";
import { joinCompetition } from "@/services/participant.service";
import type { SessionKind } from "@/models/Session";

export const TZ = "Asia/Kolkata";
export const PASSWORD = "Str0ng!Passw0rd";

let hashed: string | null = null;

export async function createUser(opts: { email?: string; name?: string; role?: Role; active?: boolean } = {}) {
  hashed ??= await hashPassword(PASSWORD);
  const [user] = await User.create([
    {
      name: opts.name ?? "Test User",
      email: opts.email ?? `user${Math.random().toString(36).slice(2, 10)}@example.com`,
      passwordHash: hashed,
      role: opts.role ?? "USER",
      isActive: opts.active ?? true,
    },
  ]);
  return user;
}

/** Returns a `Cookie` header value for a fresh session. */
export async function sessionCookieFor(userId: Types.ObjectId, kind: SessionKind = "USER") {
  const { cookie } = await createSession({ userId, kind });
  return `${cookie.name}=${cookie.value}`;
}

/** Correct answer for day N is deterministic so tests can pick right/wrong options. */
export function correctFor(day: number): OptionId {
  return (["A", "B", "C", "D"] as const)[(day - 1) % 4]!;
}
export function wrongFor(day: number): OptionId {
  return correctFor(day) === "A" ? "B" : "A";
}

/**
 * Creates a published competition whose Day 1 is `startOffsetDays` from today
 * (negative = already running) in Asia/Kolkata, with one published question per day.
 */
export async function createRunningCompetition(opts: {
  startOffsetDays?: number;
  durationDays?: number;
  status?: ICompetition["status"];
  scoring?: ICompetition["scoring"];
  revealMode?: "AUTOMATIC" | "MANUAL";
  now?: Date;
} = {}) {
  const durationDays = opts.durationDays ?? 5;
  const today = localDateInZone(opts.now ?? new Date(), TZ);
  const startLocal = addDaysToLocalDate(today, opts.startOffsetDays ?? 0);
  const [comp] = await Competition.create([
    {
      name: `Test Challenge ${Math.random().toString(36).slice(2, 6)}`,
      slug: `test-${Math.random().toString(36).slice(2, 10)}`,
      description: "Test competition",
      startDate: computeStartDate(startLocal, TZ),
      endDate: computeEndDate(startLocal, durationDays, TZ),
      durationDays,
      timezone: TZ,
      status: opts.status ?? "SCHEDULED",
      scoring: opts.scoring ?? { pointsPerCorrectAnswer: 1, negativeMarking: false, negativePoints: 0 },
      leaderboardRevealMode: opts.revealMode ?? "AUTOMATIC",
      registrationOpen: true,
      publishedAt: new Date(),
    },
  ]);
  const docs = Array.from({ length: durationDays }, (_, i) => {
    const day = i + 1;
    return {
      competitionId: comp._id,
      dayNumber: day,
      questionText: `Question for day ${day}?`,
      options: (["A", "B", "C", "D"] as const).map((id) => ({ id, text: `Option ${id} (day ${day})` })),
      correctOptionId: correctFor(day),
      explanation: `Because ${correctFor(day)} is right on day ${day}.`,
      category: day % 2 ? "Science" : "History",
      difficulty: "MEDIUM" as const,
      points: null,
      status: "PUBLISHED" as const,
      scheduledDate: getDayWindow(comp, day).opensAt,
    };
  });
  await Question.insertMany(docs);
  return comp.toObject();
}

/** Joins a user to a competition as of its start (questions are only shown to participants). */
export async function joinComp(comp: ICompetition, userId: Types.ObjectId) {
  return joinCompetition(comp, userId, { at: comp.startDate });
}

/** Moves the (faked) Date clock; Mongo I/O timers keep running for real. */
export function setNow(date: Date) {
  vi.useFakeTimers({ toFake: ["Date"], now: date });
}

export function dayMiddle(comp: Pick<ICompetition, "startDate" | "durationDays" | "timezone">, day: number) {
  const w = getDayWindow(comp, day);
  return new Date((w.opensAt.getTime() + w.closesAt.getTime()) / 2);
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(
  handler: unknown,
  opts: { method?: string; url?: string; body?: unknown; cookie?: string; params?: Record<string, string>; headers?: Record<string, string> } = {},
) {
  const headers = new Headers({ "content-type": "application/json", "x-real-ip": "203.0.113.7", "user-agent": "vitest", ...opts.headers });
  if (opts.cookie) headers.set("cookie", opts.cookie);
  const req = new NextRequest(new URL(opts.url ?? "/api/test", "http://localhost:3000"), {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  // Tests inspect arbitrary response shapes, so data/details are loosely typed on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: { success: boolean; data?: any; error?: { code: string; message: string; details?: any } } = { success: false };
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON (CSV) */
  }
  return { status: res.status, json, text, headers: res.headers };
}

export function cookieFromResponse(headers: Headers): string | null {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return null;
  const pair = setCookie.split(";")[0]!;
  return pair.endsWith("=") ? null : pair;
}
