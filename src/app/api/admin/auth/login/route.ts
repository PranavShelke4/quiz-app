import { apiRoute } from "@/lib/api/handler";
import { loginSchema } from "@/lib/validation/auth";
import { login } from "@/services/auth.service";

/** Separate admin sign-in: issues a short-lived ADMIN session; audited. */
export const POST = apiRoute("public", { allowDuringMaintenance: true }, async (ctx) => {
  const input = await ctx.body(loginSchema);
  const { user, cookie } = await login(input, ctx.meta, "ADMIN");
  ctx.setCookie(cookie);
  return { user };
});
