import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, inject, vi } from "vitest";
import { connectDb } from "@/lib/db/mongoose";
import { invalidateSettingsCache } from "@/services/settings.service";

process.env.MONGODB_URI = inject("mongoUri");

beforeAll(async () => {
  await connectDb();
  // Build every index (unique constraints are part of what we test).
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

beforeEach(async () => {
  vi.useRealTimers();
  invalidateSettingsCache();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  (globalThis as { __mongoose?: unknown }).__mongoose = undefined;
});
