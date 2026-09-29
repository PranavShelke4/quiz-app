import { apiRoute } from "@/lib/api/handler";
import { getAdminDashboard } from "@/services/analytics.service";

export const GET = apiRoute("admin", { permission: "analytics:view" }, async () => getAdminDashboard());
