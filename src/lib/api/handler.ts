import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { fail, ok } from "@/lib/api/response";
import { hasPermission, isAdminRole, type Permission } from "@/lib/auth/rbac";
import {
  SESSION_COOKIE_NAME,
  rotateSessionIfDue,
  validateSessionToken,
  type AuthContext,
  type CookieToSet,
} from "@/lib/auth/session";
import { env } from "@/lib/env";
import { AppError, isAppError, isDatabaseUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { safeEqual } from "@/lib/security/crypto";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getRequestMeta, type RequestMeta } from "@/lib/security/request-meta";
import { toPlainObject } from "@/lib/validation/common";
import { getSettings } from "@/services/settings.service";

/**
 * Access levels:
 *  public   — no session required (session is still resolved if present)
 *  user     — any signed-in, active user
 *  admin    — ADMIN/SUPER_ADMIN with an ADMIN session (created via /admin/login)
 *  cron     — `Authorization: Bearer $CRON_SECRET`
 */
export type Access = "public" | "user" | "admin" | "cron";

export interface RouteContext<P> {
  req: NextRequest;
  params: P;
  meta: RequestMeta;
  auth: AuthContext | null;
  /** Parse + validate the JSON body. Unknown keys are stripped by the schema. */
  body<T>(schema: ZodType<T>): Promise<T>;
  /** Parse + validate query string parameters. */
  query<T>(schema: ZodType<T>): T;
  setCookie(cookie: CookieToSet): void;
}

type AuthedContext<P> = RouteContext<P> & { auth: AuthContext };

interface Options {
  permission?: Permission;
  rateLimit?: { name: string; limit: number; windowMs: number; by?: "ip" | "user" };
  /** Allow during maintenance mode (auth endpoints, admin). */
  allowDuringMaintenance?: boolean;
  /** Max JSON body bytes (default 64 KB). */
  maxBodyBytes?: number;
}

type Handler<C> = (ctx: C) => Promise<unknown>;

const DEFAULT_MAX_BODY = 64 * 1024;

export function apiRoute<P = Record<string, never>>(
  access: "user" | "admin",
  options: Options,
  handler: Handler<AuthedContext<P>>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function apiRoute<P = Record<string, never>>(
  access: "public" | "cron",
  options: Options,
  handler: Handler<RouteContext<P>>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function apiRoute<P>(
  access: Access,
  options: Options,
  handler: Handler<RouteContext<P>> | Handler<AuthedContext<P>>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const started = Date.now();
    const meta = getRequestMeta(req.headers);
    const cookies: CookieToSet[] = [];
    let auth: AuthContext | null = null;
    let response: Response;
    let errorCode: string | undefined;

    try {
      if (access === "cron") {
        const secret = env().CRON_SECRET;
        const header = req.headers.get("authorization") ?? "";
        const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (!secret || !provided || !safeEqual(provided, secret)) throw new AppError("UNAUTHORIZED");
      } else {
        auth = await validateSessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
        await authorize(access, auth, options.permission);

        if (!options.allowDuringMaintenance && access !== "admin") {
          const settings = await getSettings();
          if (settings.platform.maintenanceMode && !(auth && isAdminRole(auth.user.role))) {
            throw new AppError("MAINTENANCE_MODE");
          }
        }
      }

      if (options.rateLimit) {
        const rl = options.rateLimit;
        const subject = rl.by === "user" && auth ? `u:${auth.user.id}` : `ip:${meta.ip ?? "unknown"}`;
        await enforceRateLimit({ key: `${rl.name}:${subject}`, limit: rl.limit, windowMs: rl.windowMs });
      }

      const params = (await routeCtx.params) ?? ({} as P);
      const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
      const ctx: RouteContext<P> = {
        req,
        params,
        meta,
        auth,
        async body<T>(schema: ZodType<T>) {
          const length = Number(req.headers.get("content-length") ?? "0");
          if (length > maxBody) throw new AppError("PAYLOAD_TOO_LARGE");
          const text = await req.text();
          if (text.length > maxBody) throw new AppError("PAYLOAD_TOO_LARGE");
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.");
          }
          return schema.parse(json);
        },
        query<T>(schema: ZodType<T>) {
          return schema.parse(toPlainObject(req.nextUrl.searchParams));
        },
        setCookie(cookie) {
          cookies.push(cookie);
        },
      };

      // `authorize` guarantees ctx.auth is set for user/admin access levels.
      const result = await (handler as Handler<RouteContext<P>>)(ctx);
      response = result instanceof Response ? result : ok(result ?? null);

      // Periodic session rotation, only when the handler didn't already manage the cookie.
      if (auth && cookies.length === 0 && response.status < 400) {
        const rotated = await rotateSessionIfDue(auth, meta);
        if (rotated) cookies.push(rotated);
      }
    } catch (err) {
      response = toErrorResponse(err, meta.requestId);
      errorCode = (await safeErrorCode(response)) ?? undefined;
    }

    if (cookies.length && response instanceof NextResponse) {
      for (const c of cookies) response.cookies.set(c.name, c.value, c.options);
    }
    response.headers.set("x-request-id", meta.requestId);

    logger.info("api.request", {
      requestId: meta.requestId,
      userId: auth?.user.id ?? null,
      route: req.nextUrl.pathname,
      method: req.method,
      status: response.status,
      durationMs: Date.now() - started,
      errorCode,
    });
    return response;
  };
}

async function authorize(access: Access, auth: AuthContext | null, permission?: Permission) {
  if (access === "public") return;
  if (!auth) throw new AppError("UNAUTHORIZED");
  if (access === "admin") {
    if (!isAdminRole(auth.user.role) || auth.session.kind !== "ADMIN") throw new AppError("FORBIDDEN");
    if (!hasPermission(auth.user.role, permission ?? "admin:access")) throw new AppError("FORBIDDEN");
  } else if (permission && !hasPermission(auth.user.role, permission)) {
    throw new AppError("FORBIDDEN");
  }
}

function toErrorResponse(err: unknown, requestId: string): Response {
  if (isAppError(err)) {
    const retry =
      err.code === "RATE_LIMITED" && typeof err.details === "object" && err.details && "retryAfterSeconds" in err.details
        ? { "Retry-After": String((err.details as { retryAfterSeconds: number }).retryAfterSeconds) }
        : undefined;
    return fail(err.code, err.message, err.details, retry);
  }
  if (err instanceof ZodError) {
    return fail("VALIDATION_ERROR", undefined, { fields: z.flattenError(err).fieldErrors, formErrors: z.flattenError(err).formErrors });
  }
  if (isDatabaseUnavailableError(err)) {
    logger.error("api.database_unavailable", { requestId, error: (err as Error).message });
    return fail("SERVICE_UNAVAILABLE", undefined, { requestId }, { "Retry-After": "30" });
  }
  logger.error("api.unhandled_error", { requestId, error: err });
  // Never leak internals (stack traces, connection strings, paths) to clients.
  return fail("INTERNAL_ERROR", undefined, { requestId });
}

async function safeErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: string } };
    return body.error?.code ?? null;
  } catch {
    return null;
  }
}
