/**
 * Pure competition-calendar logic. Everything is derived from:
 *   startDate (UTC instant of local midnight of Day 1), durationDays, timezone.
 *
 * Day N opens at local 00:00 of (startLocalDate + N - 1) and closes at the next
 * local midnight. This is DST-safe because each boundary is resolved in the zone.
 */
import {
  addDaysToLocalDate,
  diffLocalDates,
  localDateInZone,
  startOfLocalDay,
  type LocalDate,
} from "@/lib/time/zoned";

export interface ScheduleInput {
  startDate: Date;
  durationDays: number;
  timezone: string;
}

export type CompetitionPhase = "NOT_STARTED" | "ACTIVE" | "ENDED";

export interface DayWindow {
  dayNumber: number;
  localDate: LocalDate;
  opensAt: Date;
  closesAt: Date;
}

export interface CompetitionClock {
  phase: CompetitionPhase;
  /** Current day number while ACTIVE; null otherwise. */
  currentDay: number | null;
  /** Highest day whose window has fully closed (0 before start, durationDays after end). */
  lastClosedDay: number;
  startsAt: Date;
  endsAt: Date;
  /** Window of the current day while ACTIVE. */
  today: DayWindow | null;
  /** Full days remaining after today (0 on the last day / after end). */
  daysRemaining: number;
  durationDays: number;
}

export function startLocalDate(input: ScheduleInput): LocalDate {
  return localDateInZone(input.startDate, input.timezone);
}

/** Computes the canonical startDate (local midnight) for a local calendar date. */
export function computeStartDate(localDate: LocalDate, timezone: string): Date {
  return startOfLocalDay(localDate, timezone);
}

/** Exclusive end instant: local midnight after the final day. */
export function computeEndDate(localStartDate: LocalDate, durationDays: number, timezone: string): Date {
  return startOfLocalDay(addDaysToLocalDate(localStartDate, durationDays), timezone);
}

export function getDayWindow(input: ScheduleInput, dayNumber: number): DayWindow {
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > input.durationDays) {
    throw new RangeError(`Day ${dayNumber} is outside 1..${input.durationDays}`);
  }
  const start = startLocalDate(input);
  const localDate = addDaysToLocalDate(start, dayNumber - 1);
  return {
    dayNumber,
    localDate,
    opensAt: startOfLocalDay(localDate, input.timezone),
    closesAt: startOfLocalDay(addDaysToLocalDate(localDate, 1), input.timezone),
  };
}

export function getAllDayWindows(input: ScheduleInput): DayWindow[] {
  return Array.from({ length: input.durationDays }, (_, i) => getDayWindow(input, i + 1));
}

export function getCompetitionClock(input: ScheduleInput, at: Date): CompetitionClock {
  const start = startLocalDate(input);
  const startsAt = startOfLocalDay(start, input.timezone);
  const endsAt = computeEndDate(start, input.durationDays, input.timezone);
  const base = { startsAt, endsAt, durationDays: input.durationDays };

  if (at.getTime() < startsAt.getTime()) {
    return { ...base, phase: "NOT_STARTED", currentDay: null, lastClosedDay: 0, today: null, daysRemaining: input.durationDays };
  }
  if (at.getTime() >= endsAt.getTime()) {
    return { ...base, phase: "ENDED", currentDay: null, lastClosedDay: input.durationDays, today: null, daysRemaining: 0 };
  }

  const elapsed = diffLocalDates(start, localDateInZone(at, input.timezone));
  const currentDay = Math.min(Math.max(elapsed + 1, 1), input.durationDays);
  return {
    ...base,
    phase: "ACTIVE",
    currentDay,
    lastClosedDay: currentDay - 1,
    today: getDayWindow(input, currentDay),
    daysRemaining: input.durationDays - currentDay,
  };
}

/** How a specific day relates to "now" — used to reject past/future access. */
export type DayAccess = "UPCOMING" | "OPEN" | "CLOSED";

export function getDayAccess(input: ScheduleInput, dayNumber: number, at: Date): DayAccess {
  const w = getDayWindow(input, dayNumber);
  if (at.getTime() < w.opensAt.getTime()) return "UPCOMING";
  if (at.getTime() >= w.closesAt.getTime()) return "CLOSED";
  return "OPEN";
}
