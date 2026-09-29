import { z } from "zod";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema } from "@/lib/validation/common";
import { getCompetitionAnalytics } from "@/services/analytics.service";
import { getCompetitionById } from "@/services/competition.service";

export const GET = apiRoute("admin", { permission: "analytics:view" }, async (ctx) => {
  const { competitionId } = ctx.query(z.object({ competitionId: objectIdSchema }));
  return getCompetitionAnalytics(await getCompetitionById(competitionId));
});
