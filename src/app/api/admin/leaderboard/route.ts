import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { adminLeaderboardQuery } from "@/lib/validation/admin";
import { objectIdSchema } from "@/lib/validation/common";
import { toAdminCompetition } from "@/services/competition.service";
import { getAdminLeaderboard, hideLeaderboard, revealLeaderboard } from "@/services/leaderboard.service";

export const GET = apiRoute("admin", { permission: "leaderboard:manage" }, async (ctx) => {
  const q = ctx.query(adminLeaderboardQuery);
  const { competition, rows, total } = await getAdminLeaderboard(q);
  return { competition: toAdminCompetition(competition), rows, total };
});

/** Reveal / hide — both audited. Reveal is refused before the competition ends. */
export const POST = apiRoute("admin", { permission: "leaderboard:manage" }, async (ctx) => {
  const { competitionId, action } = await ctx.body(z.object({ competitionId: objectIdSchema, action: z.enum(["reveal", "hide"]) }));
  const comp = action === "reveal" ? await revealLeaderboard(competitionId, actorOf(ctx)) : await hideLeaderboard(competitionId, actorOf(ctx));
  return toAdminCompetition(comp);
});
