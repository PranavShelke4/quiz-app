/**
 * Per-competition anti-cheat settings (pure; shared by server and client).
 *
 * Competitions saved before this feature existed have no settings stored and are
 * treated as "off", so turning it on is always an explicit admin decision.
 */
export interface AntiCheatSettings {
  /** Master switch. When off, the question is shown directly like before. */
  enabled: boolean;
  /** Seconds allowed after pressing Start. */
  timeLimitSeconds: number;
  /** Show the options in a different order for every participant. */
  shuffleOptions: boolean;
  /** Leaving the page (tab/app/window switch, reload, second device) ends the attempt as missed. */
  lockOnLeave: boolean;
  /** Faint name/email watermark over the question; blocks copy and right-click. */
  watermark: boolean;
  /** Ask for fullscreen on Start where the browser supports it; leaving it counts as leaving the page. */
  requireFullscreen: boolean;
  /** Flag correct answers given faster than the question can be read. */
  flagFastAnswers: boolean;
}

export const ANTICHEAT_DEFAULTS: AntiCheatSettings = {
  enabled: true,
  timeLimitSeconds: 60,
  shuffleOptions: true,
  lockOnLeave: true,
  watermark: true,
  // Off by default: iPhones can't go fullscreen in the browser, and on Android the back
  // gesture leaves fullscreen easily. When on, it's best-effort and only where supported.
  requireFullscreen: false,
  flagFastAnswers: true,
};

export const ANTICHEAT_OFF: AntiCheatSettings = { ...ANTICHEAT_DEFAULTS, enabled: false };

/**
 * "Too fast" threshold: the time needed to read the question and its options at about
 * twice normal reading speed (~30 characters/second), never less than 2 seconds.
 * A correct answer faster than this suggests the answer was known before the question was seen.
 */
export const FAST_ANSWER_CHARS_PER_SECOND = 30;
export const FAST_ANSWER_FLOOR_MS = 2_000;
export function minimumPlausibleAnswerMs(q: { questionText: string; options: { text: string }[] }): number {
  const chars = q.questionText.trim().length + q.options.reduce((n, o) => n + o.text.trim().length, 0);
  return Math.max(FAST_ANSWER_FLOOR_MS, Math.round((chars / FAST_ANSWER_CHARS_PER_SECOND) * 1000));
}

export const MIN_TIME_LIMIT_SECONDS = 10;
export const MAX_TIME_LIMIT_SECONDS = 600;

/** Network/clock slack accepted after the deadline before a submission is rejected. */
export const SUBMIT_GRACE_MS = 2_000;

export function antiCheatOf(comp: { antiCheat?: Partial<AntiCheatSettings> | null }): AntiCheatSettings {
  return comp.antiCheat ? { ...ANTICHEAT_OFF, ...comp.antiCheat } : ANTICHEAT_OFF;
}

/** Client → server attempt events. The first group ends the attempt when lockOnLeave is on. */
export const LEAVE_EVENTS = ["VISIBILITY_HIDDEN", "WINDOW_BLUR", "PAGE_HIDE", "FULLSCREEN_EXIT"] as const;
export const INFO_EVENTS = ["COPY_ATTEMPT", "CONTEXT_MENU", "FULLSCREEN_DENIED"] as const;
export const ATTEMPT_EVENTS = [...LEAVE_EVENTS, ...INFO_EVENTS] as const;
export type AttemptEventType = (typeof ATTEMPT_EVENTS)[number];

export const LOCK_REASONS = ["LEFT_PAGE", "FULLSCREEN_EXIT", "RELOADED", "SECOND_DEVICE"] as const;
export type LockReason = (typeof LOCK_REASONS)[number];

export const LOCK_REASON_LABELS: Record<LockReason | "TIME_UP", string> = {
  LEFT_PAGE: "You left the question page (switched tab, app or window).",
  FULLSCREEN_EXIT: "You left fullscreen mode.",
  RELOADED: "The question page was reloaded or opened again.",
  SECOND_DEVICE: "The question was opened on another device or browser.",
  TIME_UP: "The time limit ran out before you submitted.",
};
