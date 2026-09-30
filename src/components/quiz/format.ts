import { localDateInZone } from "@/lib/time/zoned";

/** "Today at 9:00 AM" or "Tomorrow at 9:00 AM" style label for the next question, in the competition time zone. */
export function nextQuestionLabel(nextAt: string | null, serverTime: string, timeZone: string): string | null {
  if (!nextAt) return null;
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(nextAt));
  const serverDate = new Date(serverTime);
  const nextDate = new Date(nextAt);
  const serverLocalDate = localDateInZone(serverDate, timeZone);
  const nextLocalDate = localDateInZone(nextDate, timeZone);

  if (serverLocalDate === nextLocalDate) {
    return `Today at ${time}`;
  }

  const tomorrowLocalDate = localDateInZone(new Date(serverDate.getTime() + 86_400_000), timeZone);
  if (nextLocalDate === tomorrowLocalDate) {
    return `Tomorrow at ${time}`;
  }

  const date = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" }).format(new Date(nextAt));
  return `${date} at ${time}`;
}
