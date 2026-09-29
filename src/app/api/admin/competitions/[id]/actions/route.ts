import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { recordAudit } from "@/services/audit.service";
import {
  archiveCompetition,
  getCompetitionById,
  publishCompetition,
  toAdminCompetition,
  unpublishCompetition,
} from "@/services/competition.service";
import { finalizeCompetition } from "@/services/leaderboard.service";
import { recalculateAllParticipants } from "@/services/participant.service";

const schema = z.object({ action: z.enum(["publish", "unpublish", "archive", "finalize", "recalculate"]) });

export const POST = apiRoute<{ id: string }>("admin", { permission: "competitions:manage" }, async (ctx) => {
  const { action } = await ctx.body(schema);
  const actor = actorOf(ctx);
  const id = ctx.params.id;
  switch (action) {
    case "publish":
      await publishCompetition(id, actor);
      break;
    case "unpublish":
      await unpublishCompetition(id, actor);
      break;
    case "archive":
      await archiveCompetition(id, actor);
      break;
    case "finalize":
      await finalizeCompetition(id, { actor });
      break;
    case "recalculate": {
      const comp = await getCompetitionById(id);
      const count = await recalculateAllParticipants(comp);
      await recordAudit({ adminId: actor.userId, action: "STATS_RECALCULATED", targetType: "Competition", targetId: comp._id, metadata: { participants: count }, meta: actor.meta });
      break;
    }
  }
  return toAdminCompetition(await getCompetitionById(id));
});
