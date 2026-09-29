import { connectDb } from "@/lib/db/mongoose";
import { AppError, isDuplicateKeyError } from "@/lib/errors";
import { now } from "@/lib/time/clock";
import { RateLimit } from "@/models/RateLimit";

export interface RateLimitRule {
  /** Namespaced key, e.g. `login:ip:1.2.3.4`. */
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter stored in MongoDB so limits hold across instances and
 * restarts (provider-independent; swap for Redis if traffic demands it).
 */
export async function consumeRateLimit(rule: RateLimitRule): Promise<RateLimitResult> {
  await connectDb();
  const t = now().getTime();
  const windowStart = new Date(Math.floor(t / rule.windowMs) * rule.windowMs);
  const expiresAt = new Date(windowStart.getTime() + rule.windowMs * 2);

  const increment = () =>
    RateLimit.findOneAndUpdate(
      { key: rule.key, windowStart },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: "after", projection: { count: 1 } },
    ).lean();

  let doc;
  try {
    doc = await increment();
  } catch (e) {
    // Two concurrent upserts can race on the unique index; the retry hits the existing doc.
    if (!isDuplicateKeyError(e)) throw e;
    doc = await increment();
  }
  const count = doc?.count ?? 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + rule.windowMs - t) / 1000));
  return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), retryAfterSeconds };
}

export async function enforceRateLimit(rule: RateLimitRule): Promise<void> {
  const result = await consumeRateLimit(rule);
  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", undefined, { retryAfterSeconds: result.retryAfterSeconds });
  }
}

export async function resetRateLimit(keyPrefix: string): Promise<void> {
  await connectDb();
  await RateLimit.deleteMany({ key: keyPrefix });
}
