import { apiRoute } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { getCurrentCompetition, toPublicCompetition } from "@/services/competition.service";

/** Public, non-sensitive competition info (no questions, answers or scores). */
export const GET = apiRoute("public", {}, async () => {
  const comp = await getCurrentCompetition();
  if (!comp) throw new AppError("COMPETITION_NOT_FOUND");
  return toPublicCompetition(comp);
});
