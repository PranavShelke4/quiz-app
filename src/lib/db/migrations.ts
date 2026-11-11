import type mongoose from "mongoose";
import { logger } from "@/lib/logger";

/**
 * Small idempotent data migrations, run once per process right after connecting.
 * Each step must be safe to run repeatedly and cheap when there's nothing to do.
 */
export async function runMigrations(m: typeof mongoose) {
  const db = m.connection.db;
  if (!db) return;
  await questionPools(db);
}

/**
 * Question pools: questions used to be unique per (competition, day). They're now
 * unique per (competition, day, variant), so the old unique index must go, and
 * existing questions become variant 1.
 */
async function questionPools(db: NonNullable<typeof mongoose.connection.db>) {
  const collections = await db.listCollections({ name: "questions" }, { nameOnly: true }).toArray();
  if (!collections.length) return;
  const questions = db.collection("questions");
  const indexes = await questions.indexes();
  const legacy = indexes.find((i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ competitionId: 1, dayNumber: 1 }));
  if (legacy?.name) {
    await questions.dropIndex(legacy.name);
    logger.info("migration.question_pools.dropped_index", { index: legacy.name });
  }
  const res = await questions.updateMany({ variant: { $exists: false } }, { $set: { variant: 1 } });
  if (res.modifiedCount) logger.info("migration.question_pools.backfilled", { count: res.modifiedCount });
}
