import { connectDb } from "@/lib/db/mongoose";
import { logger } from "@/lib/logger";
import { now } from "@/lib/time/clock";
import { Competition } from "@/models/Competition";
import { detectSuspiciousActivity } from "@/services/anticheat.service";
import { clockFor, syncCompetitionStatus } from "@/services/competition.service";
import { ensureCompletionState } from "@/services/leaderboard.service";
import { runReminders } from "@/services/notification.service";
import { ensureMissedRecords, lastRolloverDay, recalculateParticipantStats, runWithConcurrency } from "@/services/participant.service";

/**
 * All scheduled work, provider-independent. Triggered by POST /api/cron/run
 * (Vercel Cron, GitHub Actions, crontab + curl, `pnpm cron:run`, …).
 *
 * Every step is idempotent, so running it every 5–15 minutes is safe, and a
 * missed run is repaired by the next one (plus lazy repair on user access).
 *  1. Status transitions: SCHEDULED → ACTIVE → COMPLETED
 *  2. Daily rollover: MISSED records for closed days
 *  3. Completion: finalize ranks; automatic leaderboard reveal (+ notify)
 *  4. Reminders
 *  5. Anti-cheat heuristics for the previous day
 */
export async function runScheduledJobs(at: Date = now()) {
  await connectDb();
  const summary: Record<string, unknown>[] = [];
  const competitions = await Competition.find({
    $or: [
      { status: { $in: ["SCHEDULED", "ACTIVE"] } },
      { status: "COMPLETED", $or: [{ finalizedAt: null }, { leaderboardRevealed: false, leaderboardRevealOverridden: false }] },
    ],
  }).lean();

  for (const original of competitions) {
    const entry: Record<string, unknown> = { competitionId: String(original._id), name: original.name };
    try {
      const comp = await syncCompetitionStatus(original, at);
      entry.status = comp.status;
      const clock = clockFor(comp, at);

      // Daily rollover (incremental from the last processed day).
      const through = lastRolloverDay(comp, at);
      if (through > comp.missedProcessedThroughDay) {
        const affected = await ensureMissedRecords(comp, { fromDay: comp.missedProcessedThroughDay + 1, throughDay: through });
        await runWithConcurrency(affected, 16, (userId) => recalculateParticipantStats(comp, userId, { at }));
        await Competition.updateOne({ _id: comp._id, missedProcessedThroughDay: { $lt: through } }, { $set: { missedProcessedThroughDay: through } });
        entry.missedRecordsFor = affected.length;
        entry.rolledOverThroughDay = through;
        const flagged = await detectSuspiciousActivity(comp, through, at);
        if (flagged) entry.flagsRaised = flagged;
      }

      if (clock.phase === "ACTIVE") {
        entry.reminders = await runReminders(comp, at);
      }

      if (clock.phase === "ENDED") {
        const { comp: finalComp, revealedNow } = await ensureCompletionState(comp, at);
        entry.finalized = !!finalComp.finalizedAt;
        entry.revealed = finalComp.leaderboardRevealed;
        if (revealedNow) entry.revealedNow = true;
      }
    } catch (error) {
      logger.error("cron.competition_failed", { competitionId: String(original._id), error });
      entry.error = (error as Error).message;
    }
    summary.push(entry);
  }
  logger.info("cron.completed", { competitions: summary.length });
  return { ranAt: at.toISOString(), competitions: summary };
}
