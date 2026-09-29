import { apiRoute } from "@/lib/api/handler";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { requestPasswordReset } from "@/services/auth.service";

export const POST = apiRoute("public", { allowDuringMaintenance: true }, async (ctx) => {
  const { email } = await ctx.body(forgotPasswordSchema);
  await requestPasswordReset(email, ctx.meta);
  // Identical response whether or not the account exists.
  return { message: "If an account exists for that email, a reset link is on its way." };
});
