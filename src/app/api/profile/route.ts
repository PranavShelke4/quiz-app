import { apiRoute } from "@/lib/api/handler";
import { updateProfileSchema } from "@/lib/validation/auth";
import { getOwnProfile, updateOwnProfile } from "@/services/user.service";

export const GET = apiRoute("user", {}, async (ctx) => getOwnProfile(ctx.auth.userId));

export const PATCH = apiRoute(
  "user",
  { rateLimit: { name: "profile", limit: 30, windowMs: 3_600_000, by: "user" } },
  async (ctx) => {
    const input = await ctx.body(updateProfileSchema);
    return updateOwnProfile(ctx.auth.userId, input);
  },
);
