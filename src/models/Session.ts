import { Schema, model, models, type Model, type Types } from "mongoose";

export const SESSION_KINDS = ["USER", "ADMIN"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export interface ISession {
  _id: Types.ObjectId;
  /** SHA-256 of the opaque cookie token. The raw token is never stored. */
  tokenHash: string;
  userId: Types.ObjectId;
  /** ADMIN sessions are created only via /admin/login and have shorter lifetimes. */
  kind: SessionKind;
  createdAt: Date;
  lastSeenAt: Date;
  /** Sliding (idle) expiry, capped at absoluteExpiresAt. TTL index removes expired docs. */
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
}

const SessionSchema = new Schema<ISession>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: SESSION_KINDS, required: true, default: "USER" },
    createdAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    rotatedAt: { type: Date, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 400 },
  },
  { timestamps: false },
);

SessionSchema.index({ tokenHash: 1 }, { unique: true });
SessionSchema.index({ userId: 1, revokedAt: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session: Model<ISession> =
  (models.Session as Model<ISession>) ?? model<ISession>("Session", SessionSchema);
