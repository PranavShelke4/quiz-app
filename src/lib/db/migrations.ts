import { createHash } from "node:crypto";
import type mongoose from "mongoose";
import { logger } from "@/lib/logger";
import { AnswerCorrection } from "@/models/AnswerCorrection";
import { AuditLog } from "@/models/AuditLog";
import { AuthToken } from "@/models/AuthToken";
import { Competition } from "@/models/Competition";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Notification } from "@/models/Notification";
import { PushSubscription } from "@/models/PushSubscription";
import { Question } from "@/models/Question";
import { QuizAttempt } from "@/models/QuizAttempt";
import { RateLimit } from "@/models/RateLimit";
import { Session } from "@/models/Session";
import { Settings } from "@/models/Settings";
import { SuspicionFlag } from "@/models/SuspicionFlag";
import { User } from "@/models/User";

type Db = NonNullable<typeof mongoose.connection.db>;

const MODELS = [AnswerCorrection, AuditLog, AuthToken, Competition, CompetitionParticipant, DailyAnswer, Notification, PushSubscription, Question, QuizAttempt, RateLimit, Session, Settings, SuspicionFlag, User];

/** One-off data fixes, run once per database and remembered in `_meta`. Each must be idempotent. */
const MIGRATIONS: Record<string, (db: Db) => Promise<void>> = {
  "2026-question-pools": questionPools,
};

interface MetaDoc {
  _id: string;
  done?: string[];
  indexHash?: string;
}

/**
 * Runs pending migrations and creates any new indexes, right after connecting. Serverless
 * cold starts made the old "check everything every time" approach cost several round trips
 * per instance, so a single `_meta` read now decides whether there is anything to do.
 */
export async function runMigrations(m: typeof mongoose) {
  const db = m.connection.db;
  if (!db) return;
  const meta = db.collection<MetaDoc>("_meta");
  const state = (await meta.findOne({ _id: "schema" })) ?? { _id: "schema" };

  for (const [name, run] of Object.entries(MIGRATIONS)) {
    if (state.done?.includes(name)) continue;
    await run(db);
    await meta.updateOne({ _id: "schema" }, { $addToSet: { done: name } }, { upsert: true });
    logger.info("migration.applied", { name });
  }

  const indexHash = createHash("sha256")
    .update(JSON.stringify(MODELS.map((model) => [model.collection.collectionName, model.schema.indexes()])))
    .digest("hex");
  if (state.indexHash !== indexHash) {
    // createIndexes only adds; it never drops an index someone created by hand.
    await Promise.all(MODELS.map((model) => model.createIndexes()));
    await meta.updateOne({ _id: "schema" }, { $set: { indexHash } }, { upsert: true });
    logger.info("migration.indexes_synced", { indexHash });
  }
}

/**
 * Question pools: questions used to be unique per (competition, day). They're now
 * unique per (competition, day, variant), so the old unique index must go, and
 * existing questions become variant 1.
 */
async function questionPools(db: Db) {
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
