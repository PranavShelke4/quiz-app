import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema } from "@/lib/validation/common";
import { deleteQuestions } from "@/services/question.service";

const schema = z.object({
  competitionId: objectIdSchema,
  ids: z.array(objectIdSchema).min(1).max(500),
});

/** Deletes several questions of one competition at once (all-or-nothing). */
export const POST = apiRoute("admin", { permission: "questions:manage" }, async (ctx) => {
  const { competitionId, ids } = await ctx.body(schema);
  return deleteQuestions(competitionId, ids, actorOf(ctx));
});
