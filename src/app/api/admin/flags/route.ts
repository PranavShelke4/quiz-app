import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema, paginationSchema } from "@/lib/validation/common";
import { FLAG_STATUSES } from "@/models/SuspicionFlag";
import { listFlags, reviewFlag } from "@/services/anticheat.service";

export const GET = apiRoute("admin", { permission: "flags:manage" }, async (ctx) =>
  listFlags(ctx.query(paginationSchema.extend({ status: z.enum(FLAG_STATUSES).optional(), competitionId: objectIdSchema.optional() }))),
);

export const POST = apiRoute("admin", { permission: "flags:manage" }, async (ctx) => {
  const input = await ctx.body(z.object({ id: objectIdSchema, status: z.enum(["DISMISSED", "CONFIRMED"]), note: z.string().trim().max(1000).default("") }));
  await reviewFlag(input.id, input.status, input.note, actorOf(ctx));
  return { ok: true };
});
