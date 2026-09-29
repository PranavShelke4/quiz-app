import { z } from "zod";
import { apiRoute } from "@/lib/api/handler";
import { getPublicLeaderboard } from "@/services/leaderboard.service";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
});

/** LEADERBOARD_LOCKED (403) until the competition has ended and results are revealed. */
export const GET = apiRoute("user", {}, async (ctx) => {
  const { page, pageSize } = ctx.query(querySchema);
  return getPublicLeaderboard({ userId: ctx.auth.userId, page, pageSize });
});
