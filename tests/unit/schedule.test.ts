import { describe, expect, it } from "vitest";
import {
  computeEndDate,
  computeStartDate,
  getCompetitionClock,
  getDayAccess,
  getDayWindow,
} from "@/lib/competition/schedule";
import { addDaysToLocalDate, diffLocalDates, isValidLocalDate, localDateInZone, zonedTimeToUtc } from "@/lib/time/zoned";

const kolkata = (local: string, time = "00:00:00") => new Date(`${local}T${time}+05:30`);

describe("time zone helpers", () => {
  it("converts local midnight in Asia/Kolkata to UTC", () => {
    expect(zonedTimeToUtc("2026-10-01", "Asia/Kolkata").toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  it("handles DST transitions (America/New_York)", () => {
    // Spring forward on 2026-03-08: midnight is still EST (-05:00); the next midnight is EDT (-04:00).
    expect(zonedTimeToUtc("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(zonedTimeToUtc("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("does calendar arithmetic across months and leap years", () => {
    expect(addDaysToLocalDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToLocalDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(diffLocalDates("2026-10-01", "2026-10-30")).toBe(29);
    expect(isValidLocalDate("2026-02-30")).toBe(false);
  });

  it("reads the local date of an instant", () => {
    expect(localDateInZone(new Date("2026-09-30T18:29:59Z"), "Asia/Kolkata")).toBe("2026-09-30");
    expect(localDateInZone(new Date("2026-09-30T18:30:00Z"), "Asia/Kolkata")).toBe("2026-10-01");
  });
});

describe("competition day calculation", () => {
  const input = { startDate: computeStartDate("2026-10-01", "Asia/Kolkata"), durationDays: 30, timezone: "Asia/Kolkata" };

  it("derives the exclusive end date", () => {
    expect(computeEndDate("2026-10-01", 30, "Asia/Kolkata").toISOString()).toBe(kolkata("2026-10-31").toISOString());
  });

  it("is NOT_STARTED before Day 1 opens", () => {
    const c = getCompetitionClock(input, kolkata("2026-09-30", "23:59:59"));
    expect(c.phase).toBe("NOT_STARTED");
    expect(c.currentDay).toBeNull();
    expect(c.lastClosedDay).toBe(0);
  });

  it("maps Oct 1 → Day 1, Oct 2 → Day 2, Oct 30 → Day 30", () => {
    expect(getCompetitionClock(input, kolkata("2026-10-01")).currentDay).toBe(1);
    expect(getCompetitionClock(input, kolkata("2026-10-01", "23:59:59")).currentDay).toBe(1);
    expect(getCompetitionClock(input, kolkata("2026-10-02")).currentDay).toBe(2);
    expect(getCompetitionClock(input, kolkata("2026-10-30", "12:00:00")).currentDay).toBe(30);
  });

  it("rolls over at local midnight, not UTC midnight", () => {
    // 2026-10-01T19:00Z is already Oct 2, 00:30 in Kolkata.
    expect(getCompetitionClock(input, new Date("2026-10-01T19:00:00Z")).currentDay).toBe(2);
  });

  it("is ENDED from local midnight after Day 30", () => {
    const c = getCompetitionClock(input, kolkata("2026-10-31"));
    expect(c.phase).toBe("ENDED");
    expect(c.lastClosedDay).toBe(30);
    expect(c.daysRemaining).toBe(0);
  });

  it("computes days remaining after today", () => {
    expect(getCompetitionClock(input, kolkata("2026-10-12", "10:00:00")).daysRemaining).toBe(18);
  });

  it("computes the daily deadline", () => {
    const w = getDayWindow(input, 12);
    expect(w.opensAt.toISOString()).toBe(kolkata("2026-10-12").toISOString());
    expect(w.closesAt.toISOString()).toBe(kolkata("2026-10-13").toISOString());
  });

  it("classifies day access as past/open/future", () => {
    const at = kolkata("2026-10-05", "08:00:00");
    expect(getDayAccess(input, 4, at)).toBe("CLOSED");
    expect(getDayAccess(input, 5, at)).toBe("OPEN");
    expect(getDayAccess(input, 6, at)).toBe("UPCOMING");
  });

  it("keeps 24h-local days across DST (America/New_York)", () => {
    const ny = { startDate: computeStartDate("2026-03-07", "America/New_York"), durationDays: 3, timezone: "America/New_York" };
    const day2 = getDayWindow(ny, 2); // 2026-03-08 is only 23h long
    expect(day2.closesAt.getTime() - day2.opensAt.getTime()).toBe(23 * 3_600_000);
    expect(getCompetitionClock(ny, new Date("2026-03-09T04:30:00Z")).currentDay).toBe(3);
  });

  it("rejects out-of-range days", () => {
    expect(() => getDayWindow(input, 0)).toThrow();
    expect(() => getDayWindow(input, 31)).toThrow();
  });
});
