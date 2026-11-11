import { apiRoute } from "@/lib/api/handler";
import { getQuizState } from "@/services/quiz.service";

/**
 * Today's question + the caller's own submission state. Never includes the answer key.
 * The session id lets timed attempts tell a reload (same browser) from a second device.
 */
export const GET = apiRoute("user", {}, async (ctx) => getQuizState(ctx.auth.userId, undefined, { sessionId: ctx.auth.session.id }));
