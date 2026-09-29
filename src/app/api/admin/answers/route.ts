import { apiRoute } from "@/lib/api/handler";
import { answerFiltersSchema } from "@/lib/validation/admin";
import { paginationSchema } from "@/lib/validation/common";
import { listAnswers } from "@/services/answers.service";

export const GET = apiRoute("admin", { permission: "answers:view" }, async (ctx) => {
  const q = ctx.query(answerFiltersSchema.extend(paginationSchema.shape));
  return listAnswers(q, q.page, q.pageSize);
});
