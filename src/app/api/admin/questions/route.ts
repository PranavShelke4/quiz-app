import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema, searchSchema } from "@/lib/validation/common";
import { DIFFICULTIES, createQuestionSchema } from "@/lib/validation/quiz";
import { createQuestion, listQuestions, toAdminQuestion } from "@/services/question.service";

export const GET = apiRoute("admin", { permission: "questions:manage" }, async (ctx) => {
  const q = ctx.query(
    z.object({
      competitionId: objectIdSchema,
      search: searchSchema,
      status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
      category: z.string().max(60).optional(),
      difficulty: z.enum(DIFFICULTIES).optional(),
    }),
  );
  const { questions, categories } = await listQuestions(q);
  return { items: questions.map(toAdminQuestion), categories };
});

export const POST = apiRoute("admin", { permission: "questions:manage" }, async (ctx) => {
  const input = await ctx.body(createQuestionSchema);
  return toAdminQuestion(await createQuestion(input, actorOf(ctx)));
});
