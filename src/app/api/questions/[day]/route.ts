import { apiRoute } from "@/lib/api/handler";
import { getQuestionForDay } from "@/services/quiz.service";

/**
 * GET /api/questions/:day — only today's question is ever served.
 * Past days → QUESTION_EXPIRED; future days (or "tomorrow") → QUESTION_NOT_AVAILABLE.
 */
export const GET = apiRoute<{ day: string }>("user", {}, async (ctx) => getQuestionForDay(ctx.params.day));
