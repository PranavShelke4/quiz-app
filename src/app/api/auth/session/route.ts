import { apiRoute } from "@/lib/api/handler";

export const GET = apiRoute("public", { allowDuringMaintenance: true }, async (ctx) => ({
  authenticated: !!ctx.auth,
  user: ctx.auth?.user ?? null,
  sessionKind: ctx.auth?.session.kind ?? null,
  expiresAt: ctx.auth?.session.absoluteExpiresAt.toISOString() ?? null,
}));
