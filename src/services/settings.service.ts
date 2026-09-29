import { z } from "zod";
import { connectDb } from "@/lib/db/mongoose";
import { isValidTimeZone } from "@/lib/time/zoned";
import { DEFAULT_SETTINGS, Settings, type ISettings } from "@/models/Settings";
import type { Types } from "mongoose";

export type PlatformSettings = Omit<ISettings, "_id" | "createdAt" | "updatedAt" | "updatedBy">;

const CACHE_TTL_MS = 10_000;
type SettingsCache = { value: PlatformSettings; at: number } | null;
const g = globalThis as typeof globalThis & { __settingsCache?: SettingsCache };

function merge(doc: Partial<ISettings> | null): PlatformSettings {
  return {
    key: "global",
    competitionDefaults: { ...DEFAULT_SETTINGS.competitionDefaults, ...(doc?.competitionDefaults ?? {}) },
    security: { ...DEFAULT_SETTINGS.security, ...(doc?.security ?? {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(doc?.notifications ?? {}) },
    platform: { ...DEFAULT_SETTINGS.platform, ...(doc?.platform ?? {}) },
    globalSessionsInvalidatedAt: doc?.globalSessionsInvalidatedAt ?? null,
  };
}

/** Settings with a short per-instance cache (settings change rarely; 10s staleness is acceptable). */
export async function getSettings(options: { fresh?: boolean } = {}): Promise<PlatformSettings> {
  const cached = g.__settingsCache;
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  await connectDb();
  const doc = await Settings.findOne({ key: "global" }).lean();
  const value = merge(doc);
  g.__settingsCache = { value, at: Date.now() };
  return value;
}

export function invalidateSettingsCache() {
  g.__settingsCache = null;
}

export const generalSettingsSchema = z.object({
  competitionDefaults: z
    .object({
      durationDays: z.number().int().min(1).max(90),
      pointsPerCorrectAnswer: z.number().int().min(1).max(100),
      timezone: z.string().refine(isValidTimeZone, "Unknown time zone"),
    })
    .partial()
    .optional(),
  notifications: z
    .object({
      dailyReminderEnabled: z.boolean(),
      dailyReminderHour: z.number().int().min(0).max(23),
      deadlineReminderEnabled: z.boolean(),
      deadlineReminderHoursBefore: z.number().int().min(1).max(12),
      resultEmailEnabled: z.boolean(),
    })
    .partial()
    .optional(),
});

/** Security + platform settings: SUPER_ADMIN only. */
export const sensitiveSettingsSchema = z.object({
  security: z
    .object({
      sessionMaxDays: z.number().int().min(1).max(90),
      sessionIdleDays: z.number().int().min(1).max(90),
      adminSessionHours: z.number().int().min(1).max(72),
      loginAttemptLimit: z.number().int().min(3).max(20),
      lockoutMinutes: z.number().int().min(1).max(1440),
      loginRateLimitPerIp: z.number().int().min(5).max(1000),
      signupRateLimitPerIp: z.number().int().min(1).max(1000),
    })
    .partial()
    .optional(),
  platform: z
    .object({
      maintenanceMode: z.boolean(),
      registrationEnabled: z.boolean(),
    })
    .partial()
    .optional(),
});

export const updateSettingsSchema = generalSettingsSchema.extend(sensitiveSettingsSchema.shape);
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export function touchesSensitiveSettings(input: UpdateSettingsInput): boolean {
  return Boolean(
    (input.security && Object.keys(input.security).length) || (input.platform && Object.keys(input.platform).length),
  );
}

function flatten(prefix: string, obj: Record<string, unknown> | undefined, out: Record<string, unknown>) {
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[`${prefix}.${k}`] = v;
}

export async function updateSettings(input: UpdateSettingsInput, actorId: Types.ObjectId) {
  await connectDb();
  const before = await getSettings({ fresh: true });
  const $set: Record<string, unknown> = { updatedBy: actorId };
  flatten("competitionDefaults", input.competitionDefaults, $set);
  flatten("notifications", input.notifications, $set);
  flatten("security", input.security, $set);
  flatten("platform", input.platform, $set);
  await Settings.updateOne({ key: "global" }, { $set, $setOnInsert: { key: "global" } }, { upsert: true });
  invalidateSettingsCache();
  const after = await getSettings({ fresh: true });
  return { before, after };
}

export async function setGlobalSessionsInvalidatedAt(at: Date, actorId: Types.ObjectId) {
  await connectDb();
  await Settings.updateOne(
    { key: "global" },
    { $set: { globalSessionsInvalidatedAt: at, updatedBy: actorId }, $setOnInsert: { key: "global" } },
    { upsert: true },
  );
  invalidateSettingsCache();
}
