import { Schema, model, models, type Model, type Types } from "mongoose";

export const AUDIT_ACTIONS = [
  "ADMIN_LOGIN",
  "ADMIN_LOGOUT",
  "ADMIN_SETUP",
  "USER_DISABLED",
  "USER_ENABLED",
  "USER_FORCE_LOGOUT",
  "USER_PASSWORD_RESET_SENT",
  "USER_EMAIL_VERIFIED",
  "USER_ROLE_CHANGED",
  "GLOBAL_LOGOUT",
  "QUESTION_CREATED",
  "QUESTION_UPDATED",
  "QUESTION_DELETED",
  "QUESTION_PUBLISHED",
  "QUESTION_UNPUBLISHED",
  "QUESTIONS_IMPORTED",
  "QUESTIONS_REORDERED",
  "COMPETITION_CREATED",
  "COMPETITION_UPDATED",
  "COMPETITION_PUBLISHED",
  "COMPETITION_UNPUBLISHED",
  "COMPETITION_ARCHIVED",
  "COMPETITION_DELETED",
  "COMPETITION_FINALIZED",
  "STATS_RECALCULATED",
  "ANSWER_CORRECTED",
  "LEADERBOARD_REVEALED",
  "LEADERBOARD_HIDDEN",
  "SETTINGS_UPDATED",
  "FLAG_REVIEWED",
  "EXPORT_GENERATED",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface IAuditLog {
  _id: Types.ObjectId;
  adminId: Types.ObjectId | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 400 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ adminId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1 });

// Append-only: block every update/delete path at the model layer.
const blocked = () => {
  throw new Error("Audit logs are append-only");
};
for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  AuditLogSchema.pre(op, blocked);
}
AuditLogSchema.pre("save", function () {
  if (!this.isNew) throw new Error("Audit logs are append-only");
});

export const AuditLog: Model<IAuditLog> =
  (models.AuditLog as Model<IAuditLog>) ?? model<IAuditLog>("AuditLog", AuditLogSchema);
