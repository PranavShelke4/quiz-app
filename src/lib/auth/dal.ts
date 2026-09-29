import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasPermission, isAdminRole, type Permission } from "@/lib/auth/rbac";
import { SESSION_COOKIE_NAME, validateSessionToken, type AuthContext } from "@/lib/auth/session";

/**
 * Data Access Layer for Server Components. Memoised per request with React
 * `cache`, so layouts and pages share one session lookup.
 */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const store = await cookies();
  return validateSessionToken(store.get(SESSION_COOKIE_NAME)?.value);
});

export async function requireUser(next?: string): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return auth;
}

/** Admin pages require an ADMIN session (created via /admin/login) and the given permission. */
export async function requireAdmin(permission: Permission = "admin:access", next?: string): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth || auth.session.kind !== "ADMIN" || !isAdminRole(auth.user.role)) {
    redirect(`/admin/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  if (!hasPermission(auth.user.role, permission)) redirect("/admin/forbidden");
  return auth;
}
