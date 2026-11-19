import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { pushBroadcastSchema } from "@/lib/validation/push";
import { broadcastPush, pushStats } from "@/services/push.service";

export const GET = apiRoute("admin", { permission: "notifications:send" }, async () => pushStats());

/** Sends a push notification to everyone who turned notifications on. */
export const POST = apiRoute(
  "admin",
  { permission: "notifications:send", rateLimit: { name: "push-broadcast", limit: 5, windowMs: 60_000, by: "user" } },
  async (ctx) => {
    const input = await ctx.body(pushBroadcastSchema);
    return broadcastPush({ title: input.title, body: input.body, url: input.url || "/quiz" }, actorOf(ctx));
  },
);
