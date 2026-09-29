import { apiRoute } from "@/lib/api/handler";
import { getQuizState } from "@/services/quiz.service";

/** Today's question + the caller's own submission state. Never includes the answer key. */
export const GET = apiRoute("user", {}, async (ctx) => getQuizState(ctx.auth.userId));
