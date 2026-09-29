import { apiRoute } from "@/lib/api/handler";
import { changePasswordSchema } from "@/lib/validation/auth";
import { changePassword } from "@/services/auth.service";

export const POST = apiRoute("user", {}, async (ctx) => {
  const { currentPassword, newPassword } = await ctx.body(changePasswordSchema);
  const cookie = await changePassword(ctx.auth.userId, currentPassword, newPassword, ctx.meta);
  ctx.setCookie(cookie);
  return { message: "Password updated. Other devices have been signed out." };
});
