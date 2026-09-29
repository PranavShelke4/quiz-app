/**
 * Throwaway local MongoDB replica set for development without Docker/Atlas.
 * Data is lost when the process stops.
 *
 *   pnpm db:memory            # prints a MONGODB_URI to use with `pnpm dev`
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";

const port = Number(process.env.MEMORY_DB_PORT ?? 27018);

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port }],
  });
  console.log(`In-memory MongoDB replica set running.\nMONGODB_URI=${replSet.getUri()}\nPress Ctrl+C to stop.`);
  const stop = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
