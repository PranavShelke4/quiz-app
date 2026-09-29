import { apiRoute } from "@/lib/api/handler";
import { createSession } from "@/lib/auth/session";
import { now } from "@/lib/time/clock";
import { recordAudit } from "@/services/audit.service";
import { setGlobalSessionsInvalidatedAt } from "@/services/settings.service";

/** SUPER_ADMIN: signs everyone out. The caller gets a fresh admin session. */
export const POST = apiRoute("admin", { permission: "sessions:global-logout" }, async (ctx) => {
  const at = now();
  await setGlobalSessionsInvalidatedAt(at, ctx.auth.userId);
  await recordAudit({ adminId: ctx.auth.userId, action: "GLOBAL_LOGOUT", targetType: "Settings", targetId: "global", meta: ctx.meta });
  const { cookie } = await createSession({ userId: ctx.auth.userId, kind: "ADMIN", meta: ctx.meta });
  ctx.setCookie(cookie);
  return { invalidatedAt: at.toISOString() };
});
