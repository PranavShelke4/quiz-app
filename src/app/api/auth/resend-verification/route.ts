import { apiRoute } from "@/lib/api/handler";
import { resendVerification } from "@/services/auth.service";

export const POST = apiRoute("user", { allowDuringMaintenance: true }, async (ctx) => {
  await resendVerification(ctx.auth.userId);
  return { message: "If your email isn't verified yet, a new link has been sent." };
});
