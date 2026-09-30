import { Schema, model, models, type Model, type Types } from "mongoose";

export const NOTIFICATION_TYPES = [
  "DAILY_REMINDER",
  "DEADLINE_REMINDER",
  "COMPETITION_ENDING",
  "RESULTS_REVEALED",
  "SYSTEM",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  /** Idempotency key: the same reminder is never created twice. */
  dedupeKey: string;
  readAt: Date | null;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 1000 },
    link: { type: String, default: null },
    dedupeKey: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

NotificationSchema.index({ dedupeKey: 1 }, { unique: true });
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 120 });

export const Notification: Model<INotification> =
  (models.Notification as Model<INotification>) ?? model<INotification>("Notification", NotificationSchema);
