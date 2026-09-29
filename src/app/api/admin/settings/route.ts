import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { hasPermission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/services/audit.service";
import { getSettings, touchesSensitiveSettings, updateSettings, updateSettingsSchema } from "@/services/settings.service";

export const GET = apiRoute("admin", { permission: "settings:view" }, async () => getSettings({ fresh: true }));

export const PATCH = apiRoute("admin", { permission: "settings:update:general" }, async (ctx) => {
  const input = await ctx.body(updateSettingsSchema);
  const actor = actorOf(ctx);
  // Security + platform settings are SUPER_ADMIN only.
  if (touchesSensitiveSettings(input) && !hasPermission(actor.role, "settings:update:sensitive")) {
    throw new AppError("FORBIDDEN", "Only a super admin can change security or platform settings.");
  }
  const { before, after } = await updateSettings(input, actor.userId);
  await recordAudit({ adminId: actor.userId, action: "SETTINGS_UPDATED", targetType: "Settings", targetId: "global", metadata: { changes: input, before }, meta: actor.meta });
  return after;
});
