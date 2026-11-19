import { apiRoute } from "@/lib/api/handler";
import { startAttemptSchema } from "@/lib/validation/quiz";
import { startAttempt } from "@/services/attempt.service";

/**
 * Starts today's timed attempt (or, with `dayNumber`, an operator-granted make-up day)
 * and returns the question with a server deadline.
 * The question text is never sent before this call in anti-cheat mode.
 */
export const POST = apiRoute("user", { rateLimit: { name: "attempt-start", limit: 10, windowMs: 60_000, by: "user" }, maxBodyBytes: 256 }, async (ctx) => {
  const input = await ctx.body(startAttemptSchema);
  return startAttempt({ userId: ctx.auth.userId, sessionId: ctx.auth.session.familyId, dayNumber: input.dayNumber, meta: ctx.meta });
});
