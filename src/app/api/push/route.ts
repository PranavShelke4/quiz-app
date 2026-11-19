import { apiRoute } from "@/lib/api/handler";
import { pushActionSchema } from "@/lib/validation/push";
import { hasSubscription, pushPublicKey, removeSubscription, saveSubscription } from "@/services/push.service";

/** The VAPID public key (null = push not configured; the prompt then stays hidden). */
export const GET = apiRoute("user", {}, async () => ({ publicKey: pushPublicKey() }));

/** Subscribe / unsubscribe / check this browser for the signed-in user. */
export const POST = apiRoute("user", { rateLimit: { name: "push", limit: 20, windowMs: 60_000, by: "user" }, maxBodyBytes: 4096 }, async (ctx) => {
  const input = await ctx.body(pushActionSchema);
  switch (input.action) {
    case "subscribe":
      return saveSubscription(ctx.auth.userId, input.subscription, ctx.meta.userAgent);
    case "unsubscribe":
      return removeSubscription(ctx.auth.userId, input.endpoint);
    case "check":
      return hasSubscription(ctx.auth.userId, input.endpoint);
  }
});
