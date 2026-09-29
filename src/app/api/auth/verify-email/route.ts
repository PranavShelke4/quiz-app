import { apiRoute } from "@/lib/api/handler";
import { verifyEmailSchema } from "@/lib/validation/auth";
import { verifyEmail } from "@/services/auth.service";

export const POST = apiRoute(
  "public",
  { allowDuringMaintenance: true, rateLimit: { name: "verify-email", limit: 20, windowMs: 3_600_000 } },
  async (ctx) => {
    const { token } = await ctx.body(verifyEmailSchema);
    await verifyEmail(token);
    return { verified: true };
  },
);
