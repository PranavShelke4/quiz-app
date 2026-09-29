import type { AuthContext } from "@/lib/auth/session";
import type { RequestMeta } from "@/lib/security/request-meta";

/** The acting admin/user, always taken from the server-side session — never from input. */
export function actorOf(ctx: { auth: AuthContext; meta: RequestMeta }) {
  return { userId: ctx.auth.userId, role: ctx.auth.user.role, meta: { ip: ctx.meta.ip, userAgent: ctx.meta.userAgent } };
}
