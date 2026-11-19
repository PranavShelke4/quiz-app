import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { hasPermission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/errors";
import { emailSchema, nameSchema } from "@/lib/validation/auth";
import { objectIdSchema } from "@/lib/validation/common";
import { MAX_DURATION_DAYS } from "@/lib/validation/quiz";
import { cancelReopenedDay, reopenDayForUser } from "@/services/makeup.service";
import {
  adminCreateResetLink,
  changeUserRole,
  adminUpdateUser,
  deleteUser,
  forceLogout,
  getUserDetail,
  setUserActive,
} from "@/services/user.service";

export const GET = apiRoute<{ id: string }>("admin", { permission: "users:manage" }, async (ctx) => getUserDetail(ctx.params.id));

/** Edit basic details (name, email, team). */
export const PATCH = apiRoute<{ id: string }>("admin", { permission: "users:manage" }, async (ctx) => {
  const input = await ctx.body(
    z.object({ name: nameSchema.optional(), email: emailSchema.optional(), team: z.string().trim().min(1).max(60).optional() }),
  );
  return adminUpdateUser(ctx.params.id, input, actorOf(ctx));
});

/** Permanent deletion. The body must repeat the user's email as confirmation. */
export const DELETE = apiRoute<{ id: string }>("admin", { permission: "users:manage" }, async (ctx) => {
  const input = await ctx.body(z.object({ confirmEmail: z.string().trim().min(3).max(320) }));
  return deleteUser(ctx.params.id, input.confirmEmail, actorOf(ctx));
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disable"), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("enable") }),
  z.object({ action: z.literal("force-logout") }),
  z.object({ action: z.literal("reset-password") }),
  z.object({ action: z.literal("change-role"), role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]) }),
  // Give this user another chance at a day (today: reset; earlier day: make-up attempt).
  z.object({ action: z.literal("reopen-day"), competitionId: objectIdSchema, dayNumber: z.number().int().min(1).max(MAX_DURATION_DAYS) }),
  z.object({ action: z.literal("cancel-reopen"), competitionId: objectIdSchema, dayNumber: z.number().int().min(1).max(MAX_DURATION_DAYS) }),
]);

export const POST = apiRoute<{ id: string }>("admin", { permission: "users:manage" }, async (ctx) => {
  const input = await ctx.body(actionSchema);
  const actor = actorOf(ctx);
  const id = ctx.params.id;
  switch (input.action) {
    case "disable":
      await setUserActive(id, false, input.reason, actor);
      break;
    case "enable":
      await setUserActive(id, true, undefined, actor);
      break;
    case "force-logout":
      await forceLogout(id, actor);
      break;
    case "reset-password":
      return { ok: true, resetUrl: await adminCreateResetLink(id, actor) };
    case "change-role":
      if (!hasPermission(actor.role, "admins:manage")) throw new AppError("FORBIDDEN", "Only a super admin can change roles.");
      await changeUserRole(id, input.role, actor);
      break;
    case "reopen-day":
      return reopenDayForUser({ competitionId: input.competitionId, userId: id, dayNumber: input.dayNumber, actor });
    case "cancel-reopen":
      return cancelReopenedDay({ competitionId: input.competitionId, userId: id, dayNumber: input.dayNumber, actor });
  }
  return { ok: true };
});
