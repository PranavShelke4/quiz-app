import { apiRoute } from "@/lib/api/handler";
import { attemptEventSchema } from "@/lib/validation/quiz";
import { recordAttemptEvent } from "@/services/attempt.service";

/**
 * Client-side integrity signals during a timed attempt (tab/app switch, fullscreen exit,
 * copy attempts). Leave signals end the attempt when the competition locks on leave.
 * Also accepts navigator.sendBeacon() posts sent while the page is being hidden.
 */
export const POST = apiRoute("user", { rateLimit: { name: "attempt-event", limit: 60, windowMs: 60_000, by: "user" }, maxBodyBytes: 512 }, async (ctx) => {
  const input = await ctx.body(attemptEventSchema);
  return recordAttemptEvent({ userId: ctx.auth.userId, sessionId: ctx.auth.session.familyId, type: input.type });
});
