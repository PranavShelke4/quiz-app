import { createHash } from "node:crypto";

/**
 * Question pools: a day may have several versions ("variants") of its question.
 * Each participant is assigned one version by a stable hash of (competition, day, user),
 * so the choice never changes on reload, needs no storage, and neighbours are very
 * likely to get different versions.
 */
export const MAX_VARIANTS_PER_DAY = 10;

export function variantIndexFor(params: { competitionId: string; dayNumber: number; userId: string; count: number }): number {
  if (params.count <= 1) return 0;
  const digest = createHash("sha256").update(`${params.competitionId}:${params.dayNumber}:${params.userId}`).digest();
  return digest.readUInt32BE(0) % params.count;
}

/**
 * The whole question bank in this participant's own fixed shuffled order (RANDOM mode):
 * sorted by a hash of (competition, user, question id), so adding a question only inserts
 * it somewhere in the order instead of reshuffling everything.
 */
export function bankOrderFor<T extends { _id: unknown }>(bank: readonly T[], params: { competitionId: string; userId: string }): T[] {
  const key = (q: T) => createHash("sha256").update(`${params.competitionId}:${params.userId}:${String(q._id)}`).digest("hex");
  return bank.map((q) => [key(q), q] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, q]) => q);
}

/** Picks this participant's version from the day's versions (sorted by variant). */
export function pickForParticipant<T>(versions: readonly T[], params: { competitionId: string; dayNumber: number; userId: string }): T | undefined {
  if (!versions.length) return undefined;
  return versions[variantIndexFor({ ...params, count: versions.length })];
}
