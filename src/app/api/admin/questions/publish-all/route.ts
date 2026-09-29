import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema } from "@/lib/validation/common";
import { publishAllDraftQuestions } from "@/services/question.service";

export const POST = apiRoute("admin", { permission: "questions:manage" }, async (ctx) => {
  const { competitionId } = await ctx.body(z.object({ competitionId: objectIdSchema }));
  return publishAllDraftQuestions(competitionId, actorOf(ctx));
});
