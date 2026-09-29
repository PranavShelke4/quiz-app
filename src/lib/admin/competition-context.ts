import "server-only";
import { listCompetitionOptions, getCurrentCompetition } from "@/services/competition.service";

/**
 * Resolves which competition a competition-scoped admin page should show:
 * the `competitionId` query param if valid, else the current competition, else the newest.
 */
export async function resolveCompetitionContext(requested: string | undefined) {
  const options = await listCompetitionOptions();
  const byId = new Map(options.map((o) => [String(o._id), o]));
  let selectedId = requested && byId.has(requested) ? requested : undefined;
  if (!selectedId) {
    const current = await getCurrentCompetition().catch(() => null);
    selectedId = current && byId.has(String(current._id)) ? String(current._id) : options[0] ? String(options[0]._id) : undefined;
  }
  return {
    selectedId,
    options: options.map((o) => ({ id: String(o._id), label: `${o.name} (${o.status.toLowerCase()})` })),
  };
}
