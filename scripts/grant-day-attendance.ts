/**
 * One-off operator fix: marks specific participants as having attended one day of a
 * competition with the CORRECT answer (e.g. they were blocked from answering through
 * no fault of their own). Only the listed users and only the given day are touched.
 *
 *   # dry run (default) — prints what would change, writes nothing
 *   pnpm grant-attendance \
 *     --competition compton --day 1 \
 *     --emails 90119687@icicibank.com,shrinidhinavaratna303@gmail.com
 *
 *   # apply
 *   ... same args ... --apply
 *
 * --competition matches a competition _id, slug, or (case-insensitive) name substring;
 * it must resolve to exactly one competition.
 *
 * For each user it:
 *  - requires an existing CompetitionParticipant record (never joins anyone);
 *  - skips the day if it is already ANSWERED (nothing is overwritten);
 *  - otherwise upserts that day's DailyAnswer as ANSWERED with the correct option(s)
 *    of the participant's question (same pool version they were / would be assigned),
 *    full points, and a response time equal to the SLOWEST real answer that day,
 *    so the fix gives no tie-breaker advantage;
 *  - marks a non-submitted QuizAttempt for that day as SUBMITTED (if one exists);
 *  - rebuilds the participant's aggregates and writes an audit log entry —
 *    all inside one transaction per user.
 */
import mongoose, { Types } from "mongoose";
import { connectDb, withTransaction } from "@/lib/db/mongoose";
import { getDayWindow } from "@/lib/competition/schedule";
import { correctIdsOf, pointsForQuestion } from "@/lib/quiz/scoring";
import type { OptionId } from "@/lib/validation/quiz";
import { AuditLog } from "@/models/AuditLog";
import { Competition } from "@/models/Competition";
import { CompetitionParticipant } from "@/models/CompetitionParticipant";
import { DailyAnswer } from "@/models/DailyAnswer";
import { Question } from "@/models/Question";
import { QuizAttempt } from "@/models/QuizAttempt";
import { User } from "@/models/User";
import { questionForParticipant } from "@/services/pool.service";
import { recalculateParticipantStats } from "@/services/participant.service";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  const compArg = arg("competition");
  const day = Number(arg("day") ?? "1");
  const emails = (arg("emails") ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const apply = process.argv.includes("--apply");
  if (!compArg) throw new Error("--competition is required");
  if (!Number.isInteger(day) || day < 1) throw new Error("--day must be a positive integer");
  if (!emails.length) throw new Error("--emails is required (comma-separated)");

  await connectDb();

  const or: Record<string, unknown>[] = [{ slug: compArg.toLowerCase() }, { name: { $regex: escapeRegex(compArg), $options: "i" } }];
  if (Types.ObjectId.isValid(compArg)) or.push({ _id: new Types.ObjectId(compArg) });
  const comps = await Competition.find({ $or: or }).lean();
  if (comps.length !== 1) {
    throw new Error(`--competition "${compArg}" matched ${comps.length} competitions: ${comps.map((c) => `${c.name} (${c.slug}, ${c._id})`).join("; ") || "none"}`);
  }
  const comp = comps[0]!;
  if (day > comp.durationDays) throw new Error(`Day ${day} is beyond the competition's ${comp.durationDays} days`);
  const window = getDayWindow(
    { startDate: comp.startDate, durationDays: comp.durationDays, timezone: comp.timezone, dailyStartTime: comp.dailyStartTime ?? "09:00", dailyEndTime: comp.dailyEndTime ?? "18:00" },
    day,
  );
  console.log(`Competition: ${comp.name} (${comp.slug}, ${comp._id}) status=${comp.status}`);
  console.log(`Day ${day} window: ${window.opensAt.toISOString()} → ${window.closesAt.toISOString()}`);
  console.log(apply ? "MODE: APPLY (writing to the database)\n" : "MODE: DRY RUN (no writes; pass --apply to write)\n");
  if (comp.finalizedAt) {
    console.warn("WARNING: competition is already finalized — frozen final ranks/scores will NOT change until it is re-finalized.\n");
  }

  // Slowest genuine response that day → the granted answer gets no tie-breaker edge.
  const slowest = await DailyAnswer.findOne({ competitionId: comp._id, dayNumber: day, status: "ANSWERED", responseTimeMs: { $ne: null } })
    .sort({ responseTimeMs: -1 })
    .select("responseTimeMs")
    .lean();
  const responseTimeMs = slowest?.responseTimeMs ?? window.closesAt.getTime() - window.opensAt.getTime();
  const answeredAt = new Date(Math.min(window.opensAt.getTime() + responseTimeMs, window.closesAt.getTime() - 1000));

  let changed = 0;
  for (const email of emails) {
    const user = await User.findOne({ email }).select("_id name email").lean();
    if (!user) {
      console.log(`- ${email}: SKIP — no user with this email`);
      continue;
    }
    const participant = await CompetitionParticipant.findOne({ competitionId: comp._id, userId: user._id }).lean();
    if (!participant) {
      console.log(`- ${email}: SKIP — not a participant of this competition`);
      continue;
    }
    const existing = await DailyAnswer.findOne({ competitionId: comp._id, userId: user._id, dayNumber: day }).lean();
    if (existing?.status === "ANSWERED") {
      console.log(`- ${email}: SKIP — day ${day} already ANSWERED (isCorrect=${existing.isCorrect}, score=${existing.score})`);
      continue;
    }
    const attempt = await QuizAttempt.findOne({ competitionId: comp._id, userId: user._id, dayNumber: day }).lean();
    const questionId = attempt?.questionId ?? existing?.questionId ?? null;
    const question = questionId ? await Question.findById(questionId).lean() : await questionForParticipant(comp._id, day, user._id);
    if (!question) {
      console.log(`- ${email}: SKIP — no question found for day ${day}`);
      continue;
    }
    const correct = correctIdsOf(question) as OptionId[];
    const score = pointsForQuestion(question.points, comp.scoring);

    console.log(
      `- ${email} (${user.name}): day ${day} ${existing ? existing.status : "no record"} → ANSWERED, correct=[${correct.join(",")}], score=${score}, ` +
        `responseTimeMs=${responseTimeMs}, question=${question._id} (v${question.variant})` +
        (attempt ? `, attempt ${attempt.status} → SUBMITTED` : "") +
        ` | before: score=${participant.totalScore} correct=${participant.correctAnswers} missed=${participant.missedDays}`,
    );
    if (!apply) continue;

    const stats = await withTransaction(async (session) => {
      await DailyAnswer.updateOne(
        { competitionId: comp._id, userId: user._id, dayNumber: day, status: { $ne: "ANSWERED" } },
        {
          $set: {
            questionId: question._id,
            selectedOptionId: correct[0]!,
            selectedOptionIds: correct,
            isCorrect: true,
            score,
            status: "ANSWERED",
            answeredAt,
            responseTimeMs,
            correctedAt: new Date(),
          },
          $setOnInsert: { competitionId: comp._id, userId: user._id, dayNumber: day },
        },
        { upsert: true, session },
      );
      if (attempt && attempt.status !== "SUBMITTED") {
        await QuizAttempt.updateOne({ _id: attempt._id }, { $set: { status: "SUBMITTED", lockReason: null, endedAt: attempt.endedAt ?? answeredAt } }, { session });
      }
      const s = await recalculateParticipantStats(comp, user._id, { session });
      await AuditLog.create(
        [
          {
            adminId: null,
            action: "ANSWER_CORRECTED",
            targetType: "DailyAnswer",
            targetId: `${comp._id}:${user._id}:${day}`,
            metadata: {
              reason: "Operator fix: participant missed the day; granted attendance with the correct answer",
              email,
              dayNumber: day,
              previousStatus: existing?.status ?? null,
              previousAttemptStatus: attempt?.status ?? null,
              questionId: String(question._id),
              selectedOptionIds: correct,
              score,
              responseTimeMs,
            },
          },
        ],
        { session },
      );
      return s;
    });
    changed++;
    console.log(`    applied → score=${stats.totalScore} correct=${stats.correctAnswers} answered=${stats.answeredDays} missed=${stats.missedDays}`);
  }
  console.log(`\nDone. ${apply ? `${changed} participant(s) updated.` : "Dry run only — nothing written."}`);
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error("failed:", err instanceof Error ? err.message : err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
