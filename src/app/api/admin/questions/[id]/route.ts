import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema } from "@/lib/validation/common";
import { MAX_DURATION_DAYS, updateQuestionSchema } from "@/lib/validation/quiz";
import {
  deleteQuestion,
  duplicateQuestion,
  getQuestion,
  setQuestionStatus,
  swapQuestionDays,
  toAdminQuestion,
  updateQuestion,
} from "@/services/question.service";

type Params = { id: string };

export const GET = apiRoute<Params>("admin", { permission: "questions:manage" }, async (ctx) => toAdminQuestion(await getQuestion(ctx.params.id)));

export const PATCH = apiRoute<Params>("admin", { permission: "questions:manage" }, async (ctx) => {
  const input = await ctx.body(updateQuestionSchema);
  return toAdminQuestion(await updateQuestion(ctx.params.id, input, actorOf(ctx)));
});

export const DELETE = apiRoute<Params>("admin", { permission: "questions:manage" }, async (ctx) => {
  await deleteQuestion(ctx.params.id, actorOf(ctx));
  return { deleted: true };
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish") }),
  z.object({ action: z.literal("unpublish") }),
  z.object({ action: z.literal("duplicate"), dayNumber: z.number().int().min(1).max(MAX_DURATION_DAYS), competitionId: objectIdSchema.optional() }),
  z.object({ action: z.literal("swap"), otherQuestionId: objectIdSchema }),
]);

export const POST = apiRoute<Params>("admin", { permission: "questions:manage" }, async (ctx) => {
  const input = await ctx.body(actionSchema);
  const actor = actorOf(ctx);
  switch (input.action) {
    case "publish":
      return toAdminQuestion(await setQuestionStatus(ctx.params.id, "PUBLISHED", actor));
    case "unpublish":
      return toAdminQuestion(await setQuestionStatus(ctx.params.id, "DRAFT", actor));
    case "duplicate":
      return toAdminQuestion(await duplicateQuestion(ctx.params.id, { dayNumber: input.dayNumber, competitionId: input.competitionId }, actor));
    case "swap":
      await swapQuestionDays(ctx.params.id, input.otherQuestionId, actor);
      return { swapped: true };
  }
});
