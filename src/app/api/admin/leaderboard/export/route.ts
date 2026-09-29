import { z } from "zod";
import { csvStreamResponse, single } from "@/lib/api/csv-response";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema } from "@/lib/validation/common";
import { recordAudit } from "@/services/audit.service";
import { getAdminLeaderboard } from "@/services/leaderboard.service";

export const GET = apiRoute("admin", { permission: "exports:generate" }, async (ctx) => {
  const { competitionId } = ctx.query(z.object({ competitionId: objectIdSchema }));
  const { competition, allRows } = await getAdminLeaderboard({ competitionId, page: 1, pageSize: 1 });
  await recordAudit({ adminId: ctx.auth.userId, action: "EXPORT_GENERATED", targetType: "Leaderboard", targetId: competition._id, metadata: { final: !!competition.finalizedAt }, meta: ctx.meta });
  return csvStreamResponse(
    `${competition.slug}-${competition.finalizedAt ? "final-results" : "live-standings"}.csv`,
    ["Rank", "Name", "Email", "Score", "Correct", "Wrong", "Missed", "Accuracy %", "Completion %", "Longest Streak"],
    single(allRows.map((r) => [r.rank, r.name, r.email, r.score, r.correct, r.wrong, r.missed, r.accuracy, r.completion, r.longestStreak])),
  );
});
