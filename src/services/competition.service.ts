import type { ClientSession, Types } from "mongoose";
import { getCompetitionClock, computeEndDate, computeStartDate, getDayWindow, type CompetitionClock } from "@/lib/competition/schedule";
import { connectDb } from "@/lib/db/mongoose";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { TIE_BREAKER_LABELS, type TieBreaker } from "@/lib/leaderboard/ranking";
import type { RequestMeta } from "@/lib/security/request-meta";
import { now } from "@/lib/time/clock";
import { localDateInZone, zonedTimeToUtc } from "@/lib/time/zoned";
import type { CompetitionInput } from "@/lib/validation/quiz";
import { Competition, type ICompetition } from "@/models/Competition";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { recordAudit } from "@/services/audit.service";

export type CompetitionDoc = ICompetition;

/** Statuses visible to participants. DRAFT and ARCHIVED never are. */
const PUBLISHED_STATUSES = ["SCHEDULED", "ACTIVE", "COMPLETED"] as const;

export const DEFAULT_RULES = [
  "One question is released every day at 12:00 AM (competition time zone) and closes at 11:59:59 PM the same day.",
  "Every question has exactly four options. Choose one and submit.",
  "You get one submission per day. Answers can't be changed once submitted.",
  "A day you don't answer is recorded as missed and scores 0 points.",
  "Correct answers, scores and ranks stay hidden until the competition ends and results are revealed.",
  "Using multiple accounts, automation or sharing answers is prohibited. Suspicious activity is reviewed by admins before any action.",
  "If a question is found to be wrong, admins may issue a documented correction; affected scores are recalculated for everyone.",
];

export function clockFor(comp: Pick<ICompetition, "startDate" | "durationDays" | "timezone">, at: Date = now()): CompetitionClock {
  return getCompetitionClock({ startDate: comp.startDate, durationDays: comp.durationDays, timezone: comp.timezone }, at);
}

// ---------------------------------------------------------------------------
// Public DTO — contains no scoring results and no answers.
// ---------------------------------------------------------------------------
export interface PublicCompetitionDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  timezone: string;
  durationDays: number;
  startsAt: string;
  endsAt: string;
  phase: CompetitionClock["phase"];
  currentDay: number | null;
  daysRemaining: number;
  todayOpensAt: string | null;
  todayClosesAt: string | null;
  rules: string[];
  tieBreakers: { key: TieBreaker; label: string }[];
  scoring: { pointsPerCorrectAnswer: number; negativeMarking: boolean; negativePoints: number };
  leaderboardRevealed: boolean;
  registrationOpen: boolean;
  serverTime: string;
}

export function toPublicCompetition(comp: ICompetition, at: Date = now()): PublicCompetitionDTO {
  const clock = clockFor(comp, at);
  return {
    id: String(comp._id),
    name: comp.name,
    slug: comp.slug,
    description: comp.description,
    timezone: comp.timezone,
    durationDays: comp.durationDays,
    startsAt: clock.startsAt.toISOString(),
    endsAt: clock.endsAt.toISOString(),
    phase: clock.phase,
    currentDay: clock.currentDay,
    daysRemaining: clock.daysRemaining,
    todayOpensAt: clock.today?.opensAt.toISOString() ?? null,
    todayClosesAt: clock.today?.closesAt.toISOString() ?? null,
    rules: comp.rules.length ? comp.rules : DEFAULT_RULES,
    tieBreakers: comp.tieBreakers.map((key) => ({ key, label: TIE_BREAKER_LABELS[key] })),
    scoring: { ...comp.scoring },
    leaderboardRevealed: isLeaderboardRevealed(comp, at),
    registrationOpen: isRegistrationOpen(comp, at),
    serverTime: at.toISOString(),
  };
}

export function isRegistrationOpen(comp: ICompetition, at: Date = now()): boolean {
  if (!PUBLISHED_STATUSES.includes(comp.status as (typeof PUBLISHED_STATUSES)[number]) || comp.status === "COMPLETED") return false;
  if (!comp.registrationOpen) return false;
  if (at.getTime() >= comp.endDate.getTime()) return false;
  if (comp.registrationOpensAt && at.getTime() < comp.registrationOpensAt.getTime()) return false;
  if (comp.registrationClosesAt && at.getTime() >= comp.registrationClosesAt.getTime()) return false;
  return true;
}

/**
 * Revealed only when: the competition has ended (time-based), final ranks are
 * frozen, and the reveal flag is set (automatically or by an admin).
 * It is impossible to reveal results while the competition is still running.
 */
export function isLeaderboardRevealed(comp: ICompetition, at: Date = now()): boolean {
  return comp.leaderboardRevealed && !!comp.finalizedAt && at.getTime() >= comp.endDate.getTime();
}

export function automaticRevealDue(comp: ICompetition, at: Date = now()): boolean {
  if (comp.leaderboardRevealMode !== "AUTOMATIC" || comp.leaderboardRevealOverridden || comp.leaderboardRevealed) return false;
  const revealAt = Math.max(comp.endDate.getTime(), comp.leaderboardRevealDate?.getTime() ?? 0);
  return at.getTime() >= revealAt;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The competition participants see: the running one; else the next scheduled;
 * else the most recently ended (so results stay reachable). Published only.
 */
export async function getCurrentCompetition(at: Date = now()): Promise<ICompetition | null> {
  await connectDb();
  const base = { status: { $in: PUBLISHED_STATUSES } };
  const active = await Competition.findOne({ ...base, startDate: { $lte: at }, endDate: { $gt: at } }).sort({ startDate: -1 }).lean();
  if (active) return syncCompetitionStatus(active, at);
  const upcoming = await Competition.findOne({ ...base, startDate: { $gt: at } }).sort({ startDate: 1 }).lean();
  if (upcoming) return upcoming;
  const past = await Competition.findOne({ ...base, endDate: { $lte: at } }).sort({ endDate: -1 }).lean();
  return past ? syncCompetitionStatus(past, at) : null;
}

export async function getCompetitionById(id: string | Types.ObjectId): Promise<ICompetition> {
  await connectDb();
  const comp = await Competition.findById(id).lean();
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  return comp;
}

/**
 * Brings the stored status in line with the clock (idempotent). Business rules
 * never depend on this field; it exists for admin views and reporting.
 */
export async function syncCompetitionStatus(comp: ICompetition, at: Date = now()): Promise<ICompetition> {
  const clock = clockFor(comp, at);
  let next: ICompetition["status"] | null = null;
  if (comp.status === "SCHEDULED" && clock.phase === "ACTIVE") next = "ACTIVE";
  if ((comp.status === "SCHEDULED" || comp.status === "ACTIVE") && clock.phase === "ENDED") next = "COMPLETED";
  if (!next) return comp;
  const $set: Partial<ICompetition> = { status: next };
  if (next === "ACTIVE") $set.activatedAt = at;
  if (next === "COMPLETED") $set.completedAt = at;
  await Competition.updateOne({ _id: comp._id, status: comp.status }, { $set });
  return { ...comp, ...$set };
}

export async function listCompetitions(params: { status?: ICompetition["status"]; page: number; pageSize: number }) {
  await connectDb();
  const filter = params.status ? { status: params.status } : {};
  const [items, total] = await Promise.all([
    Competition.find(filter).sort({ startDate: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean(),
    Competition.countDocuments(filter),
  ]);
  const ids = items.map((c) => c._id);
  const [questionCounts, participantCounts] = await Promise.all([
    Question.aggregate<{ _id: Types.ObjectId; total: number; published: number }>([
      { $match: { competitionId: { $in: ids } } },
      { $group: { _id: "$competitionId", total: { $sum: 1 }, published: { $sum: { $cond: [{ $eq: ["$status", "PUBLISHED"] }, 1, 0] } } } },
    ]),
    CompetitionParticipant.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { competitionId: { $in: ids } } },
      { $group: { _id: "$competitionId", count: { $sum: 1 } } },
    ]),
  ]);
  const qMap = new Map(questionCounts.map((q) => [String(q._id), q]));
  const pMap = new Map(participantCounts.map((p) => [String(p._id), p.count]));
  return {
    items: items.map((c) => ({
      competition: c,
      clock: clockFor(c),
      questions: qMap.get(String(c._id))?.total ?? 0,
      publishedQuestions: qMap.get(String(c._id))?.published ?? 0,
      participants: pMap.get(String(c._id)) ?? 0,
    })),
    total,
  };
}

export async function listCompetitionOptions() {
  await connectDb();
  return Competition.find({ status: { $ne: "ARCHIVED" } })
    .select("name status startDate durationDays timezone")
    .sort({ startDate: -1 })
    .limit(100)
    .lean();
}

// ---------------------------------------------------------------------------
// Admin mutations
// ---------------------------------------------------------------------------

type Actor = { userId: Types.ObjectId; meta: Pick<RequestMeta, "ip" | "userAgent"> };

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "competition";
}

async function uniqueSlug(base: string, excludeId?: Types.ObjectId) {
  let slug = slugify(base);
  for (let i = 2; await Competition.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }); i++) {
    slug = `${slugify(base)}-${i}`;
  }
  return slug;
}

function deriveSchedule(input: Pick<CompetitionInput, "startLocalDate" | "timezone" | "durationDays">) {
  const startDate = computeStartDate(input.startLocalDate, input.timezone);
  const endDate = computeEndDate(input.startLocalDate, input.durationDays, input.timezone);
  return { startDate, endDate };
}

function parseLocalDateTime(value: string | undefined, timezone: string): Date | null {
  if (!value) return null;
  const [date, time] = value.split("T");
  const [h, m] = (time ?? "00:00").split(":").map(Number);
  return zonedTimeToUtc(date!, timezone, h ?? 0, m ?? 0);
}

function buildDoc(input: CompetitionInput) {
  const { startDate, endDate } = deriveSchedule(input);
  const revealDate = parseLocalDateTime(input.leaderboardRevealLocalDateTime || undefined, input.timezone);
  if (revealDate && revealDate.getTime() < endDate.getTime()) {
    throw new AppError("VALIDATION_ERROR", "The leaderboard can't be revealed before the competition ends.", {
      fields: { leaderboardRevealLocalDateTime: ["Must be on or after the end of the final day"] },
    });
  }
  const registrationClosesAt = input.registrationCloseLocalDate
    ? zonedTimeToUtc(input.registrationCloseLocalDate, input.timezone)
    : null;
  return {
    name: input.name,
    description: input.description,
    startDate,
    endDate,
    durationDays: input.durationDays,
    timezone: input.timezone,
    scoring: input.scoring,
    tieBreakers: input.tieBreakers,
    leaderboardRevealMode: input.leaderboardRevealMode,
    leaderboardRevealDate: revealDate,
    registrationOpen: input.registrationOpen,
    registrationClosesAt,
    rules: input.rules,
  };
}

export async function createCompetition(input: CompetitionInput, actor: Actor): Promise<ICompetition> {
  await connectDb();
  const doc = buildDoc(input);
  const slug = input.slug ? input.slug : await uniqueSlug(input.name);
  try {
    const [created] = await Competition.create([{ ...doc, slug, status: "DRAFT", createdBy: actor.userId }]);
    await recordAudit({ adminId: actor.userId, action: "COMPETITION_CREATED", targetType: "Competition", targetId: created._id, metadata: { name: created.name }, meta: actor.meta });
    return created.toObject();
  } catch (e) {
    if (isDuplicateKeyError(e)) throw new AppError("CONFLICT", "That slug is already in use.");
    throw e;
  }
}

/** Fields that may change after the competition has started. */
const SAFE_AFTER_START = new Set(["name", "description", "rules", "leaderboardRevealMode", "leaderboardRevealLocalDateTime", "registrationOpen", "registrationCloseLocalDate"]);

export async function updateCompetition(id: string, input: Partial<CompetitionInput>, actor: Actor): Promise<ICompetition> {
  await connectDb();
  const comp = await getCompetitionById(id);
  if (comp.status === "ARCHIVED") throw new AppError("COMPETITION_LOCKED", "Archived competitions are read-only.");
  const started = clockFor(comp).phase !== "NOT_STARTED";

  if (started) {
    const blocked = Object.keys(input).filter((k) => input[k as keyof CompetitionInput] !== undefined && !SAFE_AFTER_START.has(k));
    if (blocked.length) {
      throw new AppError("COMPETITION_LOCKED", "Dates, time zone, duration and scoring can't change after the competition starts. Use a correction instead.", { fields: blocked });
    }
  }

  const merged: CompetitionInput = {
    name: input.name ?? comp.name,
    description: input.description ?? comp.description,
    startLocalDate: input.startLocalDate ?? localDateInZone(comp.startDate, comp.timezone),
    timezone: input.timezone ?? comp.timezone,
    durationDays: input.durationDays ?? comp.durationDays,
    scoring: input.scoring ?? comp.scoring,
    tieBreakers: input.tieBreakers ?? comp.tieBreakers,
    leaderboardRevealMode: input.leaderboardRevealMode ?? comp.leaderboardRevealMode,
    leaderboardRevealLocalDateTime:
      input.leaderboardRevealLocalDateTime !== undefined
        ? input.leaderboardRevealLocalDateTime
        : comp.leaderboardRevealDate
          ? toLocalDateTimeInput(comp.leaderboardRevealDate, comp.timezone)
          : "",
    registrationOpen: input.registrationOpen ?? comp.registrationOpen,
    registrationCloseLocalDate:
      input.registrationCloseLocalDate !== undefined
        ? input.registrationCloseLocalDate
        : comp.registrationClosesAt
          ? localDateInZone(comp.registrationClosesAt, comp.timezone)
          : "",
    rules: input.rules ?? comp.rules,
  };
  const doc = buildDoc(merged);

  if (!started) {
    const outOfRange = await Question.countDocuments({ competitionId: comp._id, dayNumber: { $gt: merged.durationDays } });
    if (outOfRange) {
      throw new AppError("VALIDATION_ERROR", `${outOfRange} question(s) are scheduled beyond the new duration. Move or delete them first.`);
    }
    if (comp.status === "SCHEDULED") await assertNoOverlap(doc.startDate, doc.endDate, comp._id);
  }

  await Competition.updateOne({ _id: comp._id }, { $set: doc });
  if (!started) await resyncQuestionSchedule({ ...comp, ...doc });
  await recordAudit({ adminId: actor.userId, action: "COMPETITION_UPDATED", targetType: "Competition", targetId: comp._id, metadata: { changed: Object.keys(input) }, meta: actor.meta });
  return getCompetitionById(comp._id);
}

function toLocalDateTimeInput(date: Date, timezone: string) {
  const local = localDateInZone(date, timezone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${local}T${time}`;
}

export async function resyncQuestionSchedule(comp: Pick<ICompetition, "_id" | "startDate" | "durationDays" | "timezone">, session?: ClientSession) {
  const questions = await Question.find({ competitionId: comp._id }).select("dayNumber").session(session ?? null).lean();
  if (!questions.length) return;
  await Question.bulkWrite(
    questions
      .filter((q) => q.dayNumber <= comp.durationDays)
      .map((q) => ({
        updateOne: { filter: { _id: q._id }, update: { $set: { scheduledDate: getDayWindow(comp, q.dayNumber).opensAt } } },
      })),
    session ? { session } : {},
  );
}

async function assertNoOverlap(startDate: Date, endDate: Date, excludeId?: Types.ObjectId) {
  const overlap = await Competition.findOne({
    status: { $in: PUBLISHED_STATUSES },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select("name")
    .lean();
  if (overlap) throw new AppError("COMPETITION_OVERLAP", `The dates overlap with "${overlap.name}".`);
}

/** Readiness report used by the publish action and the admin UI. */
export async function getPublishReadiness(comp: ICompetition) {
  const questions = await Question.find({ competitionId: comp._id }).select("dayNumber status").lean();
  const published = new Set(questions.filter((q) => q.status === "PUBLISHED").map((q) => q.dayNumber));
  const missingDays: number[] = [];
  for (let d = 1; d <= comp.durationDays; d++) if (!published.has(d)) missingDays.push(d);
  return { ready: missingDays.length === 0, missingDays, publishedCount: published.size, totalQuestions: questions.length };
}

export async function publishCompetition(id: string, actor: Actor) {
  await connectDb();
  const comp = await getCompetitionById(id);
  if (comp.status !== "DRAFT") throw new AppError("CONFLICT", "Only draft competitions can be published.");
  if (clockFor(comp).phase !== "NOT_STARTED") {
    throw new AppError("COMPETITION_NOT_READY", "The start date has already passed. Move the start date to the future first.");
  }
  const readiness = await getPublishReadiness(comp);
  if (!readiness.ready) {
    throw new AppError("COMPETITION_NOT_READY", `Every day needs a published question. Missing: day ${readiness.missingDays.slice(0, 10).join(", ")}${readiness.missingDays.length > 10 ? "…" : ""}.`, readiness);
  }
  await assertNoOverlap(comp.startDate, comp.endDate, comp._id);
  await Competition.updateOne({ _id: comp._id, status: "DRAFT" }, { $set: { status: "SCHEDULED", publishedAt: now() } });
  await recordAudit({ adminId: actor.userId, action: "COMPETITION_PUBLISHED", targetType: "Competition", targetId: comp._id, meta: actor.meta });
  return getCompetitionById(comp._id);
}

export async function unpublishCompetition(id: string, actor: Actor) {
  await connectDb();
  const comp = await getCompetitionById(id);
  if (comp.status !== "SCHEDULED" || clockFor(comp).phase !== "NOT_STARTED") {
    throw new AppError("COMPETITION_LOCKED", "Only scheduled competitions that haven't started can be unpublished.");
  }
  await Competition.updateOne({ _id: comp._id }, { $set: { status: "DRAFT", publishedAt: null } });
  await recordAudit({ adminId: actor.userId, action: "COMPETITION_UNPUBLISHED", targetType: "Competition", targetId: comp._id, meta: actor.meta });
  return getCompetitionById(comp._id);
}

export async function archiveCompetition(id: string, actor: Actor) {
  await connectDb();
  const comp = await getCompetitionById(id);
  if (comp.status !== "COMPLETED") throw new AppError("CONFLICT", "Only completed competitions can be archived.");
  await Competition.updateOne({ _id: comp._id }, { $set: { status: "ARCHIVED", archivedAt: now() } });
  await recordAudit({ adminId: actor.userId, action: "COMPETITION_ARCHIVED", targetType: "Competition", targetId: comp._id, meta: actor.meta });
}

/** Deletes a draft competition and its questions. Anything with participant data is never deleted. */
export async function deleteCompetition(id: string, confirmName: string, actor: Actor) {
  await connectDb();
  const comp = await getCompetitionById(id);
  if (comp.status !== "DRAFT") throw new AppError("COMPETITION_LOCKED", "Only draft competitions can be deleted. Archive completed ones instead.");
  if (confirmName.trim() !== comp.name) throw new AppError("VALIDATION_ERROR", "The confirmation name doesn't match.");
  if (await DailyAnswer.exists({ competitionId: comp._id })) {
    throw new AppError("COMPETITION_LOCKED", "This competition has answer records and can't be deleted.");
  }
  await Question.deleteMany({ competitionId: comp._id });
  await CompetitionParticipant.deleteMany({ competitionId: comp._id });
  await Competition.deleteOne({ _id: comp._id });
  await recordAudit({ adminId: actor.userId, action: "COMPETITION_DELETED", targetType: "Competition", targetId: comp._id, metadata: { name: comp.name }, meta: actor.meta });
}

export function toAdminCompetition(comp: ICompetition, at: Date = now()) {
  const clock = clockFor(comp, at);
  return {
    id: String(comp._id),
    name: comp.name,
    slug: comp.slug,
    description: comp.description,
    status: comp.status,
    phase: clock.phase,
    currentDay: clock.currentDay,
    startsAt: comp.startDate.toISOString(),
    endsAt: comp.endDate.toISOString(),
    startLocalDate: localDateInZone(comp.startDate, comp.timezone),
    timezone: comp.timezone,
    durationDays: comp.durationDays,
    scoring: comp.scoring,
    tieBreakers: comp.tieBreakers,
    leaderboardRevealMode: comp.leaderboardRevealMode,
    leaderboardRevealLocalDateTime: comp.leaderboardRevealDate ? toLocalDateTimeInput(comp.leaderboardRevealDate, comp.timezone) : "",
    leaderboardRevealed: comp.leaderboardRevealed,
    leaderboardRevealedAt: comp.leaderboardRevealedAt?.toISOString() ?? null,
    registrationOpen: comp.registrationOpen,
    registrationCloseLocalDate: comp.registrationClosesAt ? localDateInZone(comp.registrationClosesAt, comp.timezone) : "",
    rules: comp.rules,
    finalizedAt: comp.finalizedAt?.toISOString() ?? null,
    publishedAt: comp.publishedAt?.toISOString() ?? null,
  };
}
export type AdminCompetitionDTO = ReturnType<typeof toAdminCompetition>;
