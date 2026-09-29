import mongoose, { type ClientSession } from "mongoose";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Cached connection (survives hot reloads and serverless warm starts).
 *
 * Injection safety: every request input is parsed by Zod into primitives before
 * it reaches a query, and `strictQuery` drops unknown filter paths. User-provided
 * search strings are regex-escaped (see escapeRegex).
 */
type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const g = globalThis as typeof globalThis & { __mongoose?: Cache };
const cache: Cache = (g.__mongoose ??= { conn: null, promise: null });

mongoose.set("strictQuery", true);
mongoose.set("autoIndex", true);

export async function connectDb(): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;
  if (!cache.promise) {
    const { MONGODB_URI, MONGODB_DB } = env();
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: MONGODB_DB,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5_000,
        retryWrites: true,
      })
      .then((m) => {
        logger.info("mongodb.connected", { db: MONGODB_DB });
        return m;
      })
      .catch((err) => {
        cache.promise = null;
        throw err;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

/**
 * Runs `fn` inside a MongoDB multi-document transaction with automatic retry on
 * transient errors. Requires a replica set (Atlas / docker-compose rs0).
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  await connectDb();
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" },
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}
