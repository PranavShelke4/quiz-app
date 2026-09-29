import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { paginationSchema } from "@/lib/validation/common";
import { createCompetitionSchema } from "@/lib/validation/quiz";
import { COMPETITION_STATUSES } from "@/models/Competition";
import { createCompetition, listCompetitions, toAdminCompetition } from "@/services/competition.service";

export const GET = apiRoute("admin", { permission: "competitions:manage" }, async (ctx) => {
  const q = ctx.query(paginationSchema.extend({ status: z.enum(COMPETITION_STATUSES).optional() }));
  const { items, total } = await listCompetitions(q);
  return {
    total,
    items: items.map((i) => ({ ...toAdminCompetition(i.competition), questions: i.questions, publishedQuestions: i.publishedQuestions, participants: i.participants })),
  };
});

export const POST = apiRoute("admin", { permission: "competitions:manage" }, async (ctx) => {
  const input = await ctx.body(createCompetitionSchema);
  const comp = await createCompetition(input, actorOf(ctx));
  return toAdminCompetition(comp);
});
