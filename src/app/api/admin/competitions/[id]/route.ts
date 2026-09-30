import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { updateCompetitionSchema } from "@/lib/validation/quiz";
import {
  deleteCompetition,
  getCompetitionById,
  getPublishReadiness,
  toAdminCompetition,
  updateCompetition,
} from "@/services/competition.service";

type Params = { id: string };

export const GET = apiRoute<Params>("admin", { permission: "competitions:manage" }, async (ctx) => {
  const comp = await getCompetitionById(ctx.params.id);
  return { competition: toAdminCompetition(comp), readiness: await getPublishReadiness(comp) };
});

export const PATCH = apiRoute<Params>("admin", { permission: "competitions:manage" }, async (ctx) => {
  const input = await ctx.body(updateCompetitionSchema);
  return toAdminCompetition(await updateCompetition(ctx.params.id, input, actorOf(ctx)));
});

export const DELETE = apiRoute<Params>("admin", { permission: "competitions:manage" }, async (ctx) => {
  let confirmName: string | undefined;
  try {
    const body = await ctx.body(z.object({ confirmName: z.string().max(200).optional() }));
    confirmName = body.confirmName;
  } catch {
    confirmName = undefined;
  }
  await deleteCompetition(ctx.params.id, confirmName, actorOf(ctx));
  return { deleted: true };
});
