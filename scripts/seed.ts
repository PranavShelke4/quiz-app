/**
 * Seeds a local database: one SUPER_ADMIN, one published 30-day competition
 * with 30 questions, and (with --demo) a verified demo participant.
 *
 *   pnpm seed            # admin + competition
 *   pnpm seed --demo     # also a demo participant
 *
 * Idempotent: re-running updates the admin/questions instead of duplicating.
 * Passwords are never hard-coded: set SEED_ADMIN_PASSWORD or one is generated and printed once.
 */
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { computeEndDate, computeStartDate, getDayWindow } from "@/lib/competition/schedule";
import { connectDb } from "@/lib/db/mongoose";
import { DEFAULT_TIE_BREAKERS } from "@/lib/leaderboard/ranking";
import { hashPassword } from "@/lib/security/password";
import { addDaysToLocalDate, localDateInZone } from "@/lib/time/zoned";
import { passwordSchema } from "@/lib/validation/auth";
import { Competition } from "@/models/Competition";
import { Question } from "@/models/Question";
import { User } from "@/models/User";
import { SEED_QUESTIONS } from "./seed-questions";

const TZ = "Asia/Kolkata";

function generatePassword() {
  return `Qz-${randomBytes(9).toString("base64url")}!9a`;
}

async function upsertUser(email: string, name: string, role: "USER" | "SUPER_ADMIN", password: string) {
  const passwordHash = await hashPassword(password);
  await User.updateOne(
    { email },
    { $set: { name, role, isActive: true, isEmailVerified: true, emailVerifiedAt: new Date(), passwordHash }, $setOnInsert: { email } },
    { upsert: true },
  );
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") {
    throw new Error("Refusing to seed a production environment (set SEED_ALLOW_PRODUCTION=true to override).");
  }
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  // --- Admin -----------------------------------------------------------------
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@example.com").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || generatePassword();
  if (!passwordSchema.safeParse(adminPassword).success) throw new Error("SEED_ADMIN_PASSWORD doesn't meet the password policy.");
  await upsertUser(adminEmail, "Platform Admin", "SUPER_ADMIN", adminPassword);

  // --- Competition -----------------------------------------------------------
  const offset = Number(process.env.SEED_START_OFFSET_DAYS ?? 0);
  const startLocal = addDaysToLocalDate(localDateInZone(new Date(), TZ), offset);
  const durationDays = 30;
  const startDate = computeStartDate(startLocal, TZ);
  const endDate = computeEndDate(startLocal, durationDays, TZ);
  const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${startLocal}T00:00:00Z`));
  const slug = `daily-challenge-${startLocal}`;

  const overlapping = await Competition.findOne({
    slug: { $ne: slug },
    status: { $in: ["SCHEDULED", "ACTIVE", "COMPLETED"] },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
  }).lean();

  let competitionNote: string;
  if (overlapping) {
    competitionNote = `Skipped: "${overlapping.name}" already covers these dates.`;
  } else {
    const admin = await User.findOne({ email: adminEmail }).lean();
    const comp = await Competition.findOneAndUpdate(
      { slug },
      {
        $set: {
          name: `${month.split(" ")[0]} Daily Challenge`,
          description: "Thirty days, thirty questions. Answer one question every day — results are revealed when the competition ends.",
          startDate,
          endDate,
          durationDays,
          timezone: TZ,
          scoring: { pointsPerCorrectAnswer: 1, negativeMarking: false, negativePoints: 0 },
          tieBreakers: DEFAULT_TIE_BREAKERS,
          leaderboardRevealMode: "AUTOMATIC",
          registrationOpen: true,
        },
        $setOnInsert: { slug, status: "SCHEDULED", publishedAt: new Date(), createdBy: admin?._id ?? null, rules: [] },
      },
      { upsert: true, returnDocument: "after" },
    );
    await Question.bulkWrite(
      SEED_QUESTIONS.slice(0, durationDays).map(([questionText, opts, correct, category, difficulty, explanation], i) => ({
        updateOne: {
          filter: { competitionId: comp!._id, dayNumber: i + 1 },
          update: {
            $set: {
              questionText,
              options: (["A", "B", "C", "D"] as const).map((id, j) => ({ id, text: opts[j] })),
              correctOptionId: correct,
              explanation,
              category,
              difficulty,
              points: null,
              status: "PUBLISHED",
              scheduledDate: getDayWindow(comp!, i + 1).opensAt,
            },
          },
          upsert: true,
        },
      })),
    );
    competitionNote = `${comp!.name}: ${startLocal} → ${addDaysToLocalDate(startLocal, durationDays - 1)} (${TZ}), 30 published questions.`;
  }

  // --- Demo participant ------------------------------------------------------
  let demoNote = "";
  if (process.argv.includes("--demo")) {
    const demoPassword = process.env.SEED_DEMO_PASSWORD || generatePassword();
    await upsertUser("demo@example.com", "Demo Player", "USER", demoPassword);
    demoNote = `\n  Demo user:   demo@example.com / ${demoPassword}`;
  }

  console.log(`
✔ Seed complete
  Admin:       ${adminEmail}${process.env.SEED_ADMIN_PASSWORD ? " (password from SEED_ADMIN_PASSWORD)" : ` / ${adminPassword}   ← generated, shown once`}${demoNote}
  Competition: ${competitionNote}
  Admin panel: ${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/admin/login
`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
