import { Schema, model, models, type Model, type Types } from "mongoose";

export const ROLES = ["USER", "ADMIN", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  avatar: string | null;
  role: Role;
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  failedLoginAttempts: number;
  lockUntil: Date | null;
  /** Any session created before this instant is invalid (force logout / password change). */
  sessionsInvalidatedAt: Date | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    // select:false — the hash is never loaded unless explicitly requested with +passwordHash.
    passwordHash: { type: String, required: true, select: false },
    avatar: { type: String, default: null, maxlength: 500 },
    role: { type: String, enum: ROLES, default: "USER", required: true },
    isActive: { type: Boolean, default: true },
    isEmailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null, select: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    sessionsInvalidatedAt: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
    disabledReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ role: 1, createdAt: -1 });
UserSchema.index({ isActive: 1, isEmailVerified: 1 });

export const User: Model<IUser> = (models.User as Model<IUser>) ?? model<IUser>("User", UserSchema);
