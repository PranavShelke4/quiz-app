import { z } from "zod";
import { apiRoute } from "@/lib/api/handler";
import { paginationSchema } from "@/lib/validation/common";
import { AUDIT_ACTIONS } from "@/models/AuditLog";
import { listAuditLogs } from "@/services/audit.service";

/** Read-only. There is intentionally no endpoint to modify or delete audit logs. */
export const GET = apiRoute("admin", { permission: "audit:view" }, async (ctx) => {
  const q = ctx.query(
    paginationSchema.extend({
      action: z.enum(AUDIT_ACTIONS).optional(),
      adminId: z.string().max(24).optional(),
      targetId: z.string().max(64).optional(),
      from: z.string().max(10).optional(),
      to: z.string().max(10).optional(),
    }),
  );
  return listAuditLogs(q);
});
