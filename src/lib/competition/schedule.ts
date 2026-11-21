/**
 * Pure competition-calendar logic. Everything is derived from:
 *   startDate (UTC instant of local midnight of Day 1), durationDays, timezone.
 *
 * Day N is the N-th quiz date counted from startLocalDate. Without a holiday rule that is
 * simply startLocalDate + N - 1; with one, holiday dates are skipped (no question that day)
 * and the remaining days move to the next working dates. Each window is resolved in the
 * zone, so it is DST-safe.
 */
import {
  addDaysToLocalDate,
  diffLocalDates,
  localDateInZone,
  startOfLocalDay,
  zonedTimeToUtc,
  type LocalDate,
} from "@/lib/time/zoned";

export interface ScheduleInput {
  startDate: Date;
  durationDays: number;
  timezone: string;
  dailyStartTime?: string; // "09:00"
  dailyEndTime?: string; // "18:00"
  /** Dates with no question. "BANK": every Sunday plus the 2nd and 4th Saturday of the month. */
  holidayRule?: HolidayRule;
  /** Extra YYYY-MM-DD dates with no question, chosen by an admin. */
  customHolidays?: readonly string[];
}

type HolidayConfig = Pick<ScheduleInput, "holidayRule" | "customHolidays">;

function hasHolidays(c: HolidayConfig): boolean {
  return (!!c.holidayRule && c.holidayRule !== "NONE") || !!c.customHolidays?.length;
}

export const HOLIDAY_RULES = ["NONE", "BANK"] as const;
export type HolidayRule = (typeof HOLIDAY_RULES)[number];
export const HOLIDAY_RULE_LABELS: Record<HolidayRule, string> = {
  NONE: "No holidays (a question every day)",
  BANK: "Bank holidays: every Sunday + 2nd & 4th Saturday",
};

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD calendar date. */
function weekdayOf(localDate: LocalDate): number {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function isHoliday(localDate: LocalDate, rule: HolidayRule | undefined, customHolidays?: readonly string[]): boolean {
  if (customHolidays?.includes(localDate)) return true;
  if (!rule || rule === "NONE") return false;
  const weekday = weekdayOf(localDate);
  if (weekday === 0) return true;
  if (weekday === 6) {
    const nth = Math.ceil(Number(localDate.slice(8, 10)) / 7);
    return nth === 2 || nth === 4;
  }
  return false;
}

/** Calendar date of quiz day N (1-based), skipping holidays. */
export function localDateForDay(input: HolidayConfig, start: LocalDate, dayNumber: number): LocalDate {
  if (!hasHolidays(input)) return addDaysToLocalDate(start, dayNumber - 1);
  let date = start;
  let count = 0;
  for (;;) {
    if (!isHoliday(date, input.holidayRule, input.customHolidays)) {
      count++;
      if (count === dayNumber) return date;
    }
    date = addDaysToLocalDate(date, 1);
  }
}

/**
 * Quiz day for a calendar date: the day whose date it is, or — on a holiday — the next
 * quiz day (still upcoming). Can exceed durationDays; callers clamp.
 */
function dayForLocalDate(input: HolidayConfig, start: LocalDate, date: LocalDate): number {
  const elapsed = diffLocalDates(start, date);
  if (!hasHolidays(input)) return elapsed + 1;
  if (elapsed < 0) return 1;
  let count = 0;
  for (let i = 0; i <= elapsed; i++) if (!isHoliday(addDaysToLocalDate(start, i), input.holidayRule, input.customHolidays)) count++;
  return isHoliday(date, input.holidayRule, input.customHolidays) ? count + 1 : count;
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
  /** True when today's calendar date is a holiday (no question; `today` is the next quiz day). */
  holidayToday?: boolean;
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

/** Exclusive end instant: local midnight after the final quiz day. */
export function computeEndDate(
  localStartDate: LocalDate,
  durationDays: number,
  timezone: string,
  holidayRule?: HolidayRule,
  customHolidays?: readonly string[],
): Date {
  return startOfLocalDay(addDaysToLocalDate(localDateForDay({ holidayRule, customHolidays }, localStartDate, durationDays), 1), timezone);
}

function parseHourMinute(timeStr?: string, defaultHour = 9, defaultMinute = 0): { hour: number; minute: number } {
  if (!timeStr) return { hour: defaultHour, minute: defaultMinute };
  const parts = timeStr.split(":").map(Number);
  const h = parts[0];
  const m = parts[1];
  return {
    hour: Number.isInteger(h) && h! >= 0 && h! <= 23 ? h! : defaultHour,
    minute: Number.isInteger(m) && m! >= 0 && m! <= 59 ? m! : defaultMinute,
  };
}

export function getDayWindow(input: ScheduleInput, dayNumber: number): DayWindow {
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > input.durationDays) {
    throw new RangeError(`Day ${dayNumber} is outside 1..${input.durationDays}`);
  }
  const start = startLocalDate(input);
  const localDate = localDateForDay(input, start, dayNumber);
  const { hour: startHour, minute: startMinute } = parseHourMinute(input.dailyStartTime, 9, 0);
  const { hour: endHour, minute: endMinute } = parseHourMinute(input.dailyEndTime, 18, 0);

  return {
    dayNumber,
    localDate,
    opensAt: zonedTimeToUtc(localDate, input.timezone, startHour, startMinute, 0),
    closesAt: zonedTimeToUtc(localDate, input.timezone, endHour, endMinute, 0),
  };
}

export function getAllDayWindows(input: ScheduleInput): DayWindow[] {
  return Array.from({ length: input.durationDays }, (_, i) => getDayWindow(input, i + 1));
}

export function getCompetitionClock(input: ScheduleInput, at: Date): CompetitionClock {
  const start = startLocalDate(input);
  const day1Window = getDayWindow(input, 1);
  const finalDayWindow = getDayWindow(input, input.durationDays);
  const startsAt = day1Window.opensAt;
  const endsAt = finalDayWindow.closesAt;
  const base = { startsAt, endsAt, durationDays: input.durationDays };

  if (at.getTime() < startsAt.getTime()) {
    return { ...base, phase: "NOT_STARTED", currentDay: null, lastClosedDay: 0, today: null, daysRemaining: input.durationDays };
  }
  if (at.getTime() >= endsAt.getTime()) {
    return { ...base, phase: "ENDED", currentDay: null, lastClosedDay: input.durationDays, today: null, daysRemaining: 0 };
  }

  // On a holiday the "current" day is the next quiz day, which simply hasn't opened yet.
  const currentDay = Math.min(Math.max(dayForLocalDate(input, start, localDateInZone(at, input.timezone)), 1), input.durationDays);
  const today = getDayWindow(input, currentDay);
  const lastClosedDay = at.getTime() >= today.closesAt.getTime() ? currentDay : currentDay - 1;

  return {
    ...base,
    phase: "ACTIVE",
    currentDay,
    lastClosedDay,
    today,
    holidayToday: isHoliday(localDateInZone(at, input.timezone), input.holidayRule, input.customHolidays),
    daysRemaining: Math.max(0, input.durationDays - currentDay),
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
