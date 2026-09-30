/**
 * Creates or promotes an admin from the command line (operator access to the DB required).
 *
 *   pnpm create-admin --email ops@example.com --name "Ops" [--role ADMIN|SUPER_ADMIN]
 *
 * Prompts for nothing and never takes a password on the command line: a strong
 * one-time password is generated and printed; the admin should change it on first login.
 */
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { connectDb } from "@/lib/db/mongoose";
import { hashPassword } from "@/lib/security/password";
import { emailSchema, nameSchema } from "@/lib/validation/auth";
import { AuditLog } from "@/models/AuditLog";
import { User } from "@/models/User";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = emailSchema.parse(arg("email"));
  const name = nameSchema.parse(arg("name") ?? "Administrator");
  const role = arg("role") === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";
  await connectDb();
  const password = `Qz-${randomBytes(12).toString("base64url")}!7b`;
  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: { role, isActive: true, passwordHash: await hashPassword(password), sessionsInvalidatedAt: new Date() },
      $setOnInsert: { email, name },
    },
    { upsert: true, returnDocument: "after" },
  );
  await AuditLog.create({ adminId: null, action: "USER_ROLE_CHANGED", targetType: "User", targetId: String(user!._id), metadata: { to: role, via: "cli" } });
  console.log(`✔ ${role} ready: ${email}\n  One-time password: ${password}\n  Sign in at /admin/login and change it from your profile.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("create-admin failed:", err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
