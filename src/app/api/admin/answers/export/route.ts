import { csvStreamResponse } from "@/lib/api/csv-response";
import { apiRoute } from "@/lib/api/handler";
import { iterateAnswers } from "@/services/answers.service";
import { recordAudit } from "@/services/audit.service";
import { answerFiltersSchema } from "@/lib/validation/admin";

export const GET = apiRoute("admin", { permission: "exports:generate" }, async (ctx) => {
  const filters = ctx.query(answerFiltersSchema);
  await recordAudit({ adminId: ctx.auth.userId, action: "EXPORT_GENERATED", targetType: "Answers", metadata: { filters }, meta: ctx.meta });
  async function* rows() {
    for await (const batch of iterateAnswers(filters)) {
      yield batch.map((a) => [
        a.userName,
        a.userEmail,
        a.competition,
        a.dayNumber,
        a.question,
        a.selectedAnswer,
        a.correctAnswer,
        a.status === "MISSED" ? "" : a.isCorrect ? "Correct" : "Incorrect",
        a.status,
        a.score,
        a.answeredAt ?? "",
      ]);
    }
  }
  return csvStreamResponse(
    "answers.csv",
    ["User", "Email", "Competition", "Day", "Question", "Selected Answer", "Correct Answer", "Result", "Status", "Score", "Timestamp"],
    rows(),
  );
});
