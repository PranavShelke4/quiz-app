import { apiRoute } from "@/lib/api/handler";
import { signupSchema } from "@/lib/validation/auth";
import { signup } from "@/services/auth.service";

export const POST = apiRoute("public", { allowDuringMaintenance: false }, async (ctx) => {
  const input = await ctx.body(signupSchema);
  const { user, cookie } = await signup(input, ctx.meta);
  ctx.setCookie(cookie);
  return { user };
});
