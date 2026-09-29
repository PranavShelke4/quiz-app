import type { ClientSession, Types } from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { logger } from "@/lib/logger";
import type { RequestMeta } from "@/lib/security/request-meta";
import { AuditLog, type AuditAction } from "@/models/AuditLog";

export interface AuditEntry {
  adminId: Types.ObjectId | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string | Types.ObjectId | null;
  metadata?: Record<string, unknown>;
  meta?: Pick<RequestMeta, "ip" | "userAgent"> | null;
}

/** Appends an audit entry. Pass `session` to make it part of a transaction. */
export async function recordAudit(entry: AuditEntry, session?: ClientSession): Promise<void> {
  await connectDb();
  const doc = {
    adminId: entry.adminId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ? String(entry.targetId) : null,
    metadata: entry.metadata ?? {},
    ipAddress: entry.meta?.ip ?? null,
    userAgent: entry.meta?.userAgent ?? null,
  };
  await AuditLog.create([doc], session ? { session } : {});
  logger.info("audit", { action: entry.action, adminId: String(entry.adminId ?? ""), targetType: doc.targetType, targetId: doc.targetId });
}

export async function listAuditLogs(params: { action?: string; adminId?: string; targetId?: string; from?: string; to?: string; page: number; pageSize: number }) {
  await connectDb();
  const filter: Record<string, unknown> = {};
  if (params.action) filter.action = params.action;
  if (params.adminId && /^[a-f0-9]{24}$/i.test(params.adminId)) filter.adminId = params.adminId;
  if (params.targetId) filter.targetId = params.targetId;
  const range: Record<string, Date> = {};
  if (params.from && !Number.isNaN(Date.parse(params.from))) range.$gte = new Date(params.from);
  if (params.to && !Number.isNaN(Date.parse(params.to))) range.$lte = new Date(`${params.to}T23:59:59.999Z`);
  if (Object.keys(range).length) filter.createdAt = range;
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .populate<{ adminId: { _id: unknown; name: string; email: string } | null }>("adminId", "name email")
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return {
    total,
    items: items.map((l) => ({
      id: String(l._id),
      action: l.action,
      admin: l.adminId ? { name: l.adminId.name, email: l.adminId.email } : null,
      targetType: l.targetType,
      targetId: l.targetId,
      metadata: l.metadata,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}
