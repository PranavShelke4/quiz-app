/**
 * The single source of "now" for all business logic.
 *
 * In development/E2E (NODE_ENV !== "production" AND ENABLE_TEST_CLOCK === "true")
 * tests may shift the server clock via /api/test/clock. In production the
 * override is unreachable: `testClockEnabled()` is false regardless of env.
 */

type ClockGlobal = typeof globalThis & { __quizClockOffsetMs?: number };

export function testClockEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_TEST_CLOCK === "true";
}

export function now(): Date {
  if (testClockEnabled()) {
    const offset = (globalThis as ClockGlobal).__quizClockOffsetMs ?? 0;
    return new Date(Date.now() + offset);
  }
  return new Date();
}

export function getTestClockOffsetMs(): number {
  return (globalThis as ClockGlobal).__quizClockOffsetMs ?? 0;
}

export function setTestClockOffsetMs(offsetMs: number): void {
  if (!testClockEnabled()) throw new Error("Test clock is disabled");
  (globalThis as ClockGlobal).__quizClockOffsetMs = offsetMs;
}
