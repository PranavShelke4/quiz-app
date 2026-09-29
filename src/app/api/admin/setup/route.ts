import { apiRoute } from "@/lib/api/handler";
import { adminSetupSchema } from "@/lib/validation/auth";
import { setupFirstAdmin } from "@/services/auth.service";

/**
 * One-time bootstrap: creates the first SUPER_ADMIN when none exists.
 * Requires ADMIN_SETUP_SECRET (16+ chars). Disabled once a super admin exists.
 */
export const POST = apiRoute("public", { allowDuringMaintenance: true }, async (ctx) => {
  const input = await ctx.body(adminSetupSchema);
  await setupFirstAdmin(input, ctx.meta);
  return { created: true };
});
