import { apiRoute } from "@/lib/api/handler";
import { SESSION_COOKIE_NAME, clearedSessionCookie, revokeSessionByToken } from "@/lib/auth/session";
import { recordAudit } from "@/services/audit.service";

export const POST = apiRoute("public", { allowDuringMaintenance: true }, async (ctx) => {
  await revokeSessionByToken(ctx.req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (ctx.auth?.session.kind === "ADMIN") {
    await recordAudit({ adminId: ctx.auth.userId, action: "ADMIN_LOGOUT", targetType: "User", targetId: ctx.auth.userId, meta: ctx.meta });
  }
  ctx.setCookie(clearedSessionCookie());
  return { loggedOut: true };
});
