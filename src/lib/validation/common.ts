import { z } from "zod";

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export const searchSchema = z.string().trim().max(100).optional();

export const sortDirSchema = z.enum(["asc", "desc"]).default("desc");

/** Escapes user input for safe use inside a RegExp (prevents ReDoS / regex injection). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toPlainObject(searchParams: URLSearchParams | Record<string, string | string[] | undefined>) {
  const out: Record<string, string> = {};
  if (searchParams instanceof URLSearchParams) {
    for (const [k, v] of searchParams) out[k] = v;
  } else {
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === "string") out[k] = v;
      else if (Array.isArray(v) && v[0] !== undefined) out[k] = v[0];
    }
  }
  return out;
}
