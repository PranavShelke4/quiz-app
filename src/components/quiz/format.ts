/** "Tomorrow at 12:00 AM" style label for the next question, in the competition time zone. */
export function nextQuestionLabel(nextAt: string | null, serverTime: string, timeZone: string): string | null {
  if (!nextAt) return null;
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(nextAt));
  const hoursAway = (Date.parse(nextAt) - Date.parse(serverTime)) / 3_600_000;
  if (hoursAway <= 24) return `Tomorrow at ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" }).format(new Date(nextAt));
  return `${date} at ${time}`;
}
