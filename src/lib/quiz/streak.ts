/**
 * Participation streaks (never correctness).
 *
 * `answeredDays` — set of day numbers the user ANSWERED.
 * `currentDay`   — today's day number while active; for an ended competition pass durationDays + 1.
 * `todayOpen`    — whether today's window is still open (an unanswered open day doesn't break a streak).
 */
export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
}

export function computeStreaks(params: {
  answeredDays: Iterable<number>;
  currentDay: number;
  todayOpen: boolean;
}): StreakResult {
  const answered = new Set(params.answeredDays);
  // Last day that counts toward the streak: today if answered or already closed, otherwise yesterday.
  const lastCountedDay =
    params.todayOpen && !answered.has(params.currentDay) ? params.currentDay - 1 : params.currentDay;

  let longest = 0;
  let run = 0;
  for (let day = 1; day <= lastCountedDay; day++) {
    if (answered.has(day)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return { currentStreak: run, longestStreak: longest };
}
