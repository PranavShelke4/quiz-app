import { apiRoute } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { getCurrentCompetition, toPublicCompetition } from "@/services/competition.service";

export const GET = apiRoute("public", {}, async () => {
  const comp = await getCurrentCompetition();
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  const c = toPublicCompetition(comp);
  return {
    phase: c.phase,
    currentDay: c.currentDay,
    durationDays: c.durationDays,
    daysRemaining: c.daysRemaining,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    todayClosesAt: c.todayClosesAt,
    leaderboardRevealed: c.leaderboardRevealed,
    serverTime: c.serverTime,
  };
});
