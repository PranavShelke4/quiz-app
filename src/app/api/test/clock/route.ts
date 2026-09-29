import { z } from "zod";
import { apiRoute } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { getTestClockOffsetMs, now, setTestClockOffsetMs, testClockEnabled } from "@/lib/time/clock";

/**
 * Development/E2E only. 404 unless NODE_ENV !== "production" AND ENABLE_TEST_CLOCK=true.
 * Lets E2E tests move the server clock (e.g. to "tomorrow").
 */
function guard() {
  if (!testClockEnabled()) throw new AppError("NOT_FOUND");
}

export const GET = apiRoute("public", { allowDuringMaintenance: true }, async () => {
  guard();
  return { now: now().toISOString(), offsetMs: getTestClockOffsetMs() };
});

export const POST = apiRoute("public", { allowDuringMaintenance: true }, async (ctx) => {
  guard();
  const input = await ctx.body(
    z.object({ offsetMs: z.number().optional(), advanceMs: z.number().optional(), setIso: z.iso.datetime().optional() }),
  );
  if (input.setIso) setTestClockOffsetMs(Date.parse(input.setIso) - Date.now());
  else if (input.advanceMs !== undefined) setTestClockOffsetMs(getTestClockOffsetMs() + input.advanceMs);
  else if (input.offsetMs !== undefined) setTestClockOffsetMs(input.offsetMs);
  return { now: now().toISOString(), offsetMs: getTestClockOffsetMs() };
});
