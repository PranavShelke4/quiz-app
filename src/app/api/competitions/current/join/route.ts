import { apiRoute } from "@/lib/api/handler";
import { joinCurrentCompetition } from "@/services/quiz.service";

export const POST = apiRoute(
  "user",
  { rateLimit: { name: "join", limit: 20, windowMs: 3_600_000, by: "user" } },
  async (ctx) => joinCurrentCompetition(ctx.auth.userId),
);
