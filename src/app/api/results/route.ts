import { apiRoute } from "@/lib/api/handler";
import { getUserResults } from "@/services/leaderboard.service";

/** The caller's day-by-day review with answer key + explanations — only after reveal. */
export const GET = apiRoute("user", {}, async (ctx) => getUserResults(ctx.auth.userId));
