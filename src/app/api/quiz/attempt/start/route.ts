import { apiRoute } from "@/lib/api/handler";
import { startAttempt } from "@/services/attempt.service";

/**
 * Starts today's timed attempt and returns the question with a server deadline.
 * The question text is never sent before this call in anti-cheat mode.
 */
export const POST = apiRoute("user", { rateLimit: { name: "attempt-start", limit: 10, windowMs: 60_000, by: "user" }, maxBodyBytes: 256 }, async (ctx) =>
  startAttempt({ userId: ctx.auth.userId, sessionId: ctx.auth.session.familyId, meta: ctx.meta }),
);
