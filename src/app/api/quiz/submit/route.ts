import { apiRoute } from "@/lib/api/handler";
import { submitAnswerSchema } from "@/lib/validation/quiz";
import { submitAnswer } from "@/services/quiz.service";

/**
 * Identity comes from the session; day, correctness and score from the server.
 * Fields like `score`, `isCorrect` or `userId` in the body are stripped by the schema.
 * The response is identical for correct and incorrect answers.
 */
export const POST = apiRoute(
  "verified",
  { rateLimit: { name: "submit", limit: 20, windowMs: 60_000, by: "user" }, maxBodyBytes: 1024 },
  async (ctx) => {
    const input = await ctx.body(submitAnswerSchema);
    return submitAnswer({
      userId: ctx.auth.userId,
      optionId: input.optionId,
      expectedDayNumber: input.dayNumber,
      expectedQuestionId: input.questionId,
      sessionId: ctx.auth.session.id,
      meta: ctx.meta,
    });
  },
);
