import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { correctionSchema } from "@/lib/validation/quiz";
import { issueCorrection } from "@/services/question.service";

/** Controlled correction of an opened question: recorded, audited, scores recalculated. */
export const POST = apiRoute<{ id: string }>("admin", { permission: "corrections:manage" }, async (ctx) => {
  const input = await ctx.body(correctionSchema);
  return issueCorrection(ctx.params.id, input, actorOf(ctx));
});
