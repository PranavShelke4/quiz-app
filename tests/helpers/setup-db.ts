import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, inject, vi } from "vitest";
import { setEmailTransportForTesting } from "@/lib/notifications/email";
import { connectDb } from "@/lib/db/mongoose";
import { invalidateSettingsCache } from "@/services/settings.service";
import { sentEmails } from "./fixtures";

process.env.MONGODB_URI = inject("mongoUri");

beforeAll(async () => {
  await connectDb();
  // Build every index (unique constraints are part of what we test).
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  setEmailTransportForTesting({
    name: "capture",
    async send(message) {
      sentEmails.push(message);
    },
  });
});

beforeEach(async () => {
  vi.useRealTimers();
  sentEmails.length = 0;
  invalidateSettingsCache();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  setEmailTransportForTesting(null);
  await mongoose.disconnect();
  (globalThis as { __mongoose?: unknown }).__mongoose = undefined;
});
