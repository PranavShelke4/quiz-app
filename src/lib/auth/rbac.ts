import type { Role } from "@/models/User";

export const PERMISSIONS = [
  "admin:access",
  "users:manage",
  "competitions:manage",
  "questions:manage",
  "answers:view",
  "leaderboard:manage",
  "analytics:view",
  "settings:view",
  "settings:update:general",
  "corrections:manage",
  "flags:manage",
  "exports:generate",
  // SUPER_ADMIN only
  "admins:manage",
  "settings:update:sensitive",
  "audit:view",
  "sessions:global-logout",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ADMIN_PERMISSIONS: Permission[] = [
  "admin:access",
  "users:manage",
  "competitions:manage",
  "questions:manage",
  "answers:view",
  "leaderboard:manage",
  "analytics:view",
  "settings:view",
  "settings:update:general",
  "corrections:manage",
  "flags:manage",
  "exports:generate",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  USER: new Set(),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  SUPER_ADMIN: new Set(PERMISSIONS),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function isAdminRole(role: Role): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
