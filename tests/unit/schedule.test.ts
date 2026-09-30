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

  it("derives the exclusive end date at local midnight after final day", () => {
    expect(computeEndDate("2026-10-01", 30, "Asia/Kolkata").toISOString()).toBe(kolkata("2026-10-31").toISOString());
  });

  it("is NOT_STARTED before Day 1 opens at 9:00 AM", () => {
    const c = getCompetitionClock(input, kolkata("2026-10-01", "08:59:59"));
    expect(c.phase).toBe("NOT_STARTED");
    expect(c.currentDay).toBeNull();
    expect(c.lastClosedDay).toBe(0);
  });

  it("maps Oct 1 → Day 1, Oct 2 → Day 2, Oct 30 → Day 30", () => {
    expect(getCompetitionClock(input, kolkata("2026-10-01", "09:00:00")).currentDay).toBe(1);
    expect(getCompetitionClock(input, kolkata("2026-10-01", "12:00:00")).currentDay).toBe(1);
    expect(getCompetitionClock(input, kolkata("2026-10-01", "20:00:00")).currentDay).toBe(1);
    expect(getCompetitionClock(input, kolkata("2026-10-02", "11:00:00")).currentDay).toBe(2);
    expect(getCompetitionClock(input, kolkata("2026-10-30", "12:00:00")).currentDay).toBe(30);
  });

  it("rolls over at local midnight, not UTC midnight", () => {
    // 2026-10-01T19:00Z is already Oct 2, 00:30 in Kolkata.
    expect(getCompetitionClock(input, new Date("2026-10-01T19:00:00Z")).currentDay).toBe(2);
  });

  it("is ENDED after final day closes at 6:00 PM", () => {
    const c = getCompetitionClock(input, kolkata("2026-10-30", "18:00:01"));
    expect(c.phase).toBe("ENDED");
    expect(c.lastClosedDay).toBe(30);
    expect(c.daysRemaining).toBe(0);
  });

  it("computes days remaining after today", () => {
    expect(getCompetitionClock(input, kolkata("2026-10-12", "10:00:00")).daysRemaining).toBe(18);
  });

  it("computes the daily deadline from 9:00 AM to 6:00 PM", () => {
    const w = getDayWindow(input, 12);
    expect(w.opensAt.toISOString()).toBe(kolkata("2026-10-12", "09:00:00").toISOString());
    expect(w.closesAt.toISOString()).toBe(kolkata("2026-10-12", "18:00:00").toISOString());
  });

  it("classifies day access as past/open/future with 9am - 6pm window", () => {
    const morning = kolkata("2026-10-05", "08:00:00");
    expect(getDayAccess(input, 4, morning)).toBe("CLOSED");
    expect(getDayAccess(input, 5, morning)).toBe("UPCOMING"); // Not open before 9am
    expect(getDayAccess(input, 6, morning)).toBe("UPCOMING");

    const midday = kolkata("2026-10-05", "11:00:00");
    expect(getDayAccess(input, 4, midday)).toBe("CLOSED");
    expect(getDayAccess(input, 5, midday)).toBe("OPEN"); // Open between 9am and 6pm
    expect(getDayAccess(input, 6, midday)).toBe("UPCOMING");

    const evening = kolkata("2026-10-05", "19:00:00");
    expect(getDayAccess(input, 5, evening)).toBe("CLOSED"); // Closed after 6pm
  });

  it("supports custom daily start and end times", () => {
    const custom = {
      startDate: computeStartDate("2026-10-01", "Asia/Kolkata"),
      durationDays: 5,
      timezone: "Asia/Kolkata",
      dailyStartTime: "10:00",
      dailyEndTime: "16:00",
    };
    const day1 = getDayWindow(custom, 1);
    expect(day1.opensAt.toISOString()).toBe(kolkata("2026-10-01", "10:00:00").toISOString());
    expect(day1.closesAt.toISOString()).toBe(kolkata("2026-10-01", "16:00:00").toISOString());
    expect(day1.closesAt.getTime() - day1.opensAt.getTime()).toBe(6 * 3_600_000);
  });

  it("rejects out-of-range days", () => {
    expect(() => getDayWindow(input, 0)).toThrow();
    expect(() => getDayWindow(input, 31)).toThrow();
  });
});
