import { NextResponse, type NextRequest } from "next/server";

/**
 * Network-edge guard (Next.js 16 `proxy`, formerly `middleware`).
 *
 * Only *optimistic* checks live here (cookie presence, origin, size). Real
 * authentication/authorization happens in every route handler (apiRoute) and
 * page (DAL), because proxy coverage can silently change with matchers.
 */

const SESSION_COOKIES = ["__Host-qz_session", "qz_session"];
const USER_PAGES = ["/dashboard", "/quiz", "/profile", "/results", "/leaderboard"];
const ADMIN_PREFIX = "/admin";
const MAX_API_BODY = 2 * 1024 * 1024; // hard cap; routes enforce tighter limits
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hasSessionCookie(req: NextRequest) {
  return SESSION_COOKIES.some((n) => !!req.cookies.get(n)?.value);
}

function jsonError(status: number, code: string, message: string, requestId: string) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status, headers: { "x-request-id": requestId, "Cache-Control": "no-store" } },
  );
}

function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) hosts.add(host.toLowerCase());
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).host.toLowerCase());
    } catch {
      /* ignore malformed config */
    }
  }
  return hosts;
}

/** CSRF defence for cookie-authenticated API calls (SameSite=Lax is the first layer). */
function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const hosts = allowedHosts(req);
  if (origin) {
    try {
      return hosts.has(new URL(origin).host.toLowerCase());
    } catch {
      return false;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return hosts.has(new URL(referer).host.toLowerCase());
    } catch {
      return false;
    }
  }
  // No browser provenance headers at all: only acceptable without an ambient session cookie.
  return !hasSessionCookie(req);
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);

  if (pathname.startsWith("/api/")) {
    const isCron = pathname.startsWith("/api/cron/");
    if (UNSAFE_METHODS.has(req.method)) {
      if (!isCron && !originAllowed(req)) {
        return jsonError(403, "CSRF_FAILED", "Request origin could not be verified.", requestId);
      }
      const length = Number(req.headers.get("content-length") ?? "0");
      if (length > MAX_API_BODY) return jsonError(413, "PAYLOAD_TOO_LARGE", "The request is too large.", requestId);
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const isAdminPage = pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
  const isAdminLogin = pathname === "/admin/login";
  const isUserPage = USER_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if ((isAdminPage && !isAdminLogin) || isUserPage) {
    if (!hasSessionCookie(req)) {
      const loginPath = isAdminPage ? "/admin/login" : "/login";
      const url = new URL(loginPath, req.url);
      url.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-request-id", requestId);
  if (isAdminPage || isUserPage) {
    // Private, per-user pages: never index, never cache in shared caches.
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("Cache-Control", "private, no-store");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
