import { z } from "zod";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema } from "@/lib/validation/common";
import { listNotifications, markNotificationsRead } from "@/services/notification.service";

export const GET = apiRoute("user", {}, async (ctx) => listNotifications(ctx.auth.userId));

export const POST = apiRoute("user", {}, async (ctx) => {
  const { ids } = await ctx.body(z.object({ ids: z.array(objectIdSchema).max(100).optional() }));
  await markNotificationsRead(ctx.auth.userId, ids);
  return { ok: true };
});
