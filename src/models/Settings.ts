import { Schema, model, models, type Model, type Types } from "mongoose";

export interface ISettings {
  _id: Types.ObjectId;
  key: "global";
  competitionDefaults: {
    durationDays: number;
    pointsPerCorrectAnswer: number;
    timezone: string;
  };
  security: {
    sessionMaxDays: number;
    sessionIdleDays: number;
    adminSessionHours: number;
    loginAttemptLimit: number;
    lockoutMinutes: number;
    loginRateLimitPerIp: number;
    signupRateLimitPerIp: number;
  };
  notifications: {
    dailyReminderEnabled: boolean;
    dailyReminderHour: number;
    deadlineReminderEnabled: boolean;
    deadlineReminderHoursBefore: number;
    resultEmailEnabled: boolean;
  };
  platform: {
    maintenanceMode: boolean;
    registrationEnabled: boolean;
  };
  /** Sessions created before this instant are invalid (SUPER_ADMIN global logout). */
  globalSessionsInvalidatedAt: Date | null;
  updatedBy: Types.ObjectId | null;
  updatedAt: Date;
  createdAt: Date;
}

export const DEFAULT_SETTINGS: Omit<ISettings, "_id" | "updatedAt" | "createdAt" | "updatedBy"> = {
  key: "global",
  competitionDefaults: { durationDays: 30, pointsPerCorrectAnswer: 1, timezone: "Asia/Kolkata" },
  security: {
    sessionMaxDays: 30,
    sessionIdleDays: 14,
    adminSessionHours: 12,
    loginAttemptLimit: 5,
    lockoutMinutes: 15,
    loginRateLimitPerIp: 30,
    signupRateLimitPerIp: 10,
  },
  notifications: {
    dailyReminderEnabled: true,
    dailyReminderHour: 9,
    deadlineReminderEnabled: true,
    deadlineReminderHoursBefore: 2,
    resultEmailEnabled: true,
  },
  platform: { maintenanceMode: false, registrationEnabled: true },
  globalSessionsInvalidatedAt: null,
};

const SettingsSchema = new Schema<ISettings>(
  {
    key: { type: String, required: true, default: "global" },
    competitionDefaults: {
      durationDays: Number,
      pointsPerCorrectAnswer: Number,
      timezone: String,
    },
    security: {
      sessionMaxDays: Number,
      sessionIdleDays: Number,
      adminSessionHours: Number,
      loginAttemptLimit: Number,
      lockoutMinutes: Number,
      loginRateLimitPerIp: Number,
      signupRateLimitPerIp: Number,
    },
    notifications: {
      dailyReminderEnabled: Boolean,
      dailyReminderHour: Number,
      deadlineReminderEnabled: Boolean,
      deadlineReminderHoursBefore: Number,
      resultEmailEnabled: Boolean,
    },
    platform: { maintenanceMode: Boolean, registrationEnabled: Boolean },
    globalSessionsInvalidatedAt: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

SettingsSchema.index({ key: 1 }, { unique: true });

export const Settings: Model<ISettings> =
  (models.Settings as Model<ISettings>) ?? model<ISettings>("Settings", SettingsSchema);
