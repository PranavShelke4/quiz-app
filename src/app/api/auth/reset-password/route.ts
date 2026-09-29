import { apiRoute } from "@/lib/api/handler";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { resetPassword } from "@/services/auth.service";

export const POST = apiRoute(
  "public",
  { allowDuringMaintenance: true, rateLimit: { name: "reset-pw", limit: 10, windowMs: 3_600_000 } },
  async (ctx) => {
    const { token, password } = await ctx.body(resetPasswordSchema);
    await resetPassword(token, password);
    return { message: "Your password has been reset. Please sign in." };
  },
);
