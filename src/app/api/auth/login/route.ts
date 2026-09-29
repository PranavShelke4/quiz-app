import { apiRoute } from "@/lib/api/handler";
import { loginSchema } from "@/lib/validation/auth";
import { login } from "@/services/auth.service";

export const POST = apiRoute("public", { allowDuringMaintenance: true }, async (ctx) => {
  const input = await ctx.body(loginSchema);
  const { user, cookie } = await login(input, ctx.meta, "USER");
  ctx.setCookie(cookie);
  return { user };
});
