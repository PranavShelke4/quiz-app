import { z } from "zod";
import { actorOf } from "@/lib/api/actor";
import { apiRoute } from "@/lib/api/handler";
import { objectIdSchema } from "@/lib/validation/common";
import { importQuestionsCsv } from "@/services/question.service";

const schema = z.object({
  competitionId: objectIdSchema,
  /** CSV text, or… */
  csv: z.string().min(1).max(1_500_000).optional(),
  /** …rows read from an .xlsx file in the browser, keyed by their header cells. */
  records: z.array(z.record(z.string().max(100), z.string().max(4000))).min(1).max(500).optional(),
  /** Validate only; nothing is written. */
  dryRun: z.boolean().default(true),
  /** Import valid rows even if others fail. Off by default: all-or-nothing. */
  skipInvalid: z.boolean().default(false),
  publish: z.boolean().default(false),
  overwrite: z.boolean().default(false),
}).refine((d) => (d.csv === undefined) !== (d.records === undefined), { path: ["csv"], message: "Send either csv or records" });

export const POST = apiRoute("admin", { permission: "questions:manage", maxBodyBytes: 1_600_000 }, async (ctx) => {
  const input = await ctx.body(schema);
  return importQuestionsCsv({ ...input, actor: actorOf(ctx) });
});
