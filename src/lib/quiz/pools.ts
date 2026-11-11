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

/** Picks this participant's version from the day's versions (sorted by variant). */
export function pickForParticipant<T>(versions: readonly T[], params: { competitionId: string; dayNumber: number; userId: string }): T | undefined {
  if (!versions.length) return undefined;
  return versions[variantIndexFor({ ...params, count: versions.length })];
}
