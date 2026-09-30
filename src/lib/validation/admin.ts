import { z } from "zod";
import { objectIdSchema, paginationSchema, searchSchema } from "@/lib/validation/common";

export const usersQuerySchema = paginationSchema.extend({
  search: searchSchema,
  status: z.enum(["active", "disabled"]).optional(),
  role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]).optional(),
  team: z.string().trim().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  sort: z.enum(["createdAt", "lastLoginAt", "name", "email"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

export const answerFiltersSchema = z.object({
  competitionId: objectIdSchema.optional(),
  day: z.coerce.number().int().min(1).max(90).optional(),
  user: searchSchema,
  status: z.enum(["ANSWERED", "MISSED"]).optional(),
  correctness: z.enum(["correct", "incorrect"]).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

export const adminLeaderboardQuery = paginationSchema.extend({
  competitionId: objectIdSchema,
  search: searchSchema,
  team: z.string().trim().optional(),
  sort: z.enum(["rank", "score", "correct", "wrong", "missed", "accuracy", "streak"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});
