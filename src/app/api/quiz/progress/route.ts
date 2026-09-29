import { apiRoute } from "@/lib/api/handler";
import { getProgress } from "@/services/quiz.service";

/** Participation only (answered/missed/streak). No score or correctness. */
export const GET = apiRoute("user", {}, async (ctx) => getProgress(ctx.auth.userId));
