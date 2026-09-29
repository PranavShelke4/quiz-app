import { Schema, model, models, type Model, type Types } from "mongoose";

/** Fixed-window counters shared by all app instances. TTL index cleans old windows. */
export interface IRateLimit {
  _id: Types.ObjectId;
  key: string;
  windowStart: Date;
  count: number;
  expiresAt: Date;
}

const RateLimitSchema = new Schema<IRateLimit>({
  key: { type: String, required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
});

RateLimitSchema.index({ key: 1, windowStart: 1 }, { unique: true });
RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit: Model<IRateLimit> =
  (models.RateLimit as Model<IRateLimit>) ?? model<IRateLimit>("RateLimit", RateLimitSchema);
