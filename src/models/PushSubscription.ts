import { Schema, type Model, type Types } from "mongoose";
import { defineModel } from "@/lib/db/model";

/** One browser/device that agreed to receive push notifications for a user. */
export interface IPushSubscription {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string | null;
  lastSuccessAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    endpoint: { type: String, required: true, maxlength: 2048 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 256 },
      auth: { type: String, required: true, maxlength: 128 },
    },
    userAgent: { type: String, default: null, maxlength: 400 },
    lastSuccessAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// A browser endpoint belongs to one user at a time (re-subscribing moves it).
PushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
PushSubscriptionSchema.index({ userId: 1 });

export const PushSubscription: Model<IPushSubscription> = defineModel<IPushSubscription>("PushSubscription", PushSubscriptionSchema);
