import mongoose from "mongoose";
import { connectDb } from "@/lib/db/mongoose";
import { getDayWindow } from "@/lib/competition/schedule";
import { Competition } from "@/models/Competition";
import { Question } from "@/models/Question";
import { SEED_QUESTIONS } from "./seed-questions";

async function main() {
  await connectDb();

  // Find competition - preferentially by slug if passed or the most recently created
  const slugArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  let comp = slugArg
    ? await Competition.findOne({ slug: slugArg })
    : await Competition.findOne().sort({ createdAt: -1 });

  if (!comp) {
    console.error("No competition found in the database. Please create a competition first!");
    process.exit(1);
  }

  console.log(`Found competition: "${comp.name}" (${comp.slug}), duration: ${comp.durationDays} days`);

  const countToAdd = Math.min(comp.durationDays, SEED_QUESTIONS.length);

  const operations = SEED_QUESTIONS.slice(0, countToAdd).map(
    ([questionText, opts, correct, category, difficulty, explanation], i) => {
      const dayNumber = i + 1;
      const window = getDayWindow(comp!, dayNumber);
      return {
        updateOne: {
          filter: { competitionId: comp!._id, dayNumber },
          update: {
            $set: {
              questionText,
              options: (["A", "B", "C", "D"] as const).map((id, j) => ({
                id,
                text: opts[j],
              })),
              correctOptionId: correct,
              explanation,
              category,
              difficulty,
              points: null,
              status: "PUBLISHED" as const,
              scheduledDate: window.opensAt,
              updatedBy: comp!.createdBy ?? null,
            },
            $setOnInsert: {
              competitionId: comp!._id,
              dayNumber,
              createdBy: comp!.createdBy ?? null,
            },
          },
          upsert: true,
        },
      };
    },
  );

  const result = await Question.bulkWrite(operations);
  console.log(`✔ Successfully added/updated ${operations.length} test questions for "${comp.name}"!`);
  console.log(`  Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}, Matched: ${result.matchedCount}`);

  const total = await Question.countDocuments({ competitionId: comp._id });
  console.log(`  Total questions now in "${comp.name}": ${total}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Failed to add test questions:", err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
