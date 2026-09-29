import { actorOf } from "@/lib/api/actor";
import { csvStreamResponse } from "@/lib/api/csv-response";
import { apiRoute } from "@/lib/api/handler";
import { connectDb } from "@/lib/db/mongoose";
import { User } from "@/models/User";
import { recordAudit } from "@/services/audit.service";
import { buildUserFilter } from "@/services/user.service";
import { usersQuerySchema } from "@/lib/validation/admin";

export const GET = apiRoute("admin", { permission: "exports:generate" }, async (ctx) => {
  const q = ctx.query(usersQuerySchema);
  await connectDb();
  const filter = buildUserFilter(q);
  await recordAudit({ adminId: ctx.auth.userId, action: "EXPORT_GENERATED", targetType: "Users", metadata: { filter: q }, meta: actorOf(ctx).meta });
  async function* rows() {
    let batch: unknown[][] = [];
    for await (const u of User.find(filter).sort({ createdAt: 1 }).lean().cursor()) {
      batch.push([u.name, u.email, u.createdAt, u.isActive ? "Active" : "Disabled", u.isEmailVerified ? "Yes" : "No", u.role, u.lastLoginAt]);
      if (batch.length >= 500) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length) yield batch;
  }
  return csvStreamResponse("users.csv", ["Name", "Email", "Registration Date", "Status", "Email Verified", "Role", "Last Login"], rows());
});
