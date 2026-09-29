/**
 * Time-zone arithmetic built on Intl (no external dependency).
 *
 * All instants are stored/handled as UTC `Date`s. A "local date" in a zone is
 * represented as an ISO calendar string `YYYY-MM-DD` (type `LocalDate`).
 */

export type LocalDate = string; // YYYY-MM-DD

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant (local = utc + offset). */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = date.getTime() - (((date.getTime() % 1000) + 1000) % 1000);
  return asUtc - truncated;
}

export function parseLocalDate(value: LocalDate): { year: number; month: number; day: number } {
  const m = LOCAL_DATE_RE.exec(value);
  if (!m) throw new Error(`Invalid local date: ${value}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Invalid local date: ${value}`);
  }
  return { year, month, day };
}

export function isValidLocalDate(value: string): boolean {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The calendar date of `date` as observed in `timeZone`. */
export function localDateInZone(date: Date, timeZone: string): LocalDate {
  const p = zonedParts(date, timeZone);
  return formatLocalDate(p.year, p.month, p.day);
}

export function addDaysToLocalDate(value: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(value);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole calendar days from `a` to `b` (b - a). */
export function diffLocalDates(a: LocalDate, b: LocalDate): number {
  const pa = parseLocalDate(a);
  const pb = parseLocalDate(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000,
  );
}

/**
 * Converts a wall-clock time in `timeZone` to the UTC instant.
 * Handles DST: resolves using the offset in effect at the resulting instant.
 * For wall times inside a DST gap, the result is shifted forward past the gap.
 */
export function zonedTimeToUtc(
  localDate: LocalDate,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const { year, month, day } = parseLocalDate(localDate);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  let candidate = wallAsUtc - firstOffset;
  const secondOffset = timeZoneOffsetMs(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) {
    candidate = wallAsUtc - secondOffset;
  }
  return new Date(candidate);
}

/** Start (00:00) of a local calendar day in `timeZone`, as a UTC instant. */
export function startOfLocalDay(localDate: LocalDate, timeZone: string): Date {
  return zonedTimeToUtc(localDate, timeZone, 0, 0, 0);
}

export function formatInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(date);
}

/** Common, human-friendly IANA zones offered in admin forms (any valid IANA zone is accepted). */
export const COMMON_TIME_ZONES = [
  "Asia/Kolkata",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;
