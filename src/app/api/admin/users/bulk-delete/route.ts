import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema } from "@/lib/validation/common";
import { deleteUsers } from "@/services/user.service";

const schema = z.object({
  ids: z.array(objectIdSchema).min(1).max(200),
  /** Must be the literal word, mirroring the typed confirmation in the UI. */
  confirm: z.literal("DELETE", { error: "Type DELETE to confirm" }),
});

/** Permanently deletes several participant accounts. Admin accounts and the caller are skipped. */
export const POST = apiRoute("admin", { permission: "users:manage" }, async (ctx) => {
  const { ids } = await ctx.body(schema);
  return deleteUsers(ids, actorOf(ctx));
});
