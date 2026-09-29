import { apiRoute } from "@/lib/api/handler";
import { runScheduledJobs } from "@/services/jobs.service";

export const maxDuration = 300;

/**
 * Scheduled jobs, protected by `Authorization: Bearer $CRON_SECRET`.
 * GET is supported because Vercel Cron issues GET requests.
 */
const handler = apiRoute("cron", {}, async () => runScheduledJobs());
export const GET = handler;
export const POST = handler;
