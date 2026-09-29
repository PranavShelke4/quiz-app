/**
 * Runs the scheduled jobs once, directly against the database (no HTTP).
 * Useful for local development or a plain crontab on a VM:
 *
 *   *\/10 * * * *  cd /app && pnpm cron:run
 */
import mongoose from "mongoose";
import { runScheduledJobs } from "@/services/jobs.service";

runScheduledJobs()
  .then(async (summary) => {
    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
  })
  .catch(async (err) => {
    console.error("cron failed:", err instanceof Error ? err.message : err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
