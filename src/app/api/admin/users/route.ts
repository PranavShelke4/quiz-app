import { apiRoute } from "@/lib/api/handler";
import { usersQuerySchema } from "@/lib/validation/admin";
import { listUsers } from "@/services/user.service";

export const GET = apiRoute("admin", { permission: "users:manage" }, async (ctx) => listUsers(ctx.query(usersQuerySchema)));
