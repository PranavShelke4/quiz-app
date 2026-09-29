import type { Metadata } from "next";
import { CalendarRange, Plus } from "lucide-react";
import { Suspense } from "react";
import { CompetitionPicker } from "@/components/admin/competition-picker";
import { sp } from "@/components/admin/filter-bar";
import { QuestionManager } from "@/components/admin/question-manager";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { resolveCompetitionContext } from "@/lib/admin/competition-context";
import { requireAdmin } from "@/lib/auth/dal";
import { clockFor } from "@/services/competition.service";
import { listQuestions, toAdminQuestion } from "@/services/question.service";

export const metadata: Metadata = { title: "Questions" };

export default async function QuestionsPage({ searchParams }: PageProps<"/admin/questions">) {
  await requireAdmin("questions:manage");
  const params = await searchParams;
  const ctx = await resolveCompetitionContext(sp(params.competitionId));

  if (!ctx.selectedId) {
    return (
      <>
        <PageHeader title="Questions" />
        <EmptyState icon={<CalendarRange />} title="No competition yet" description="Create a competition first, then add one question per day." action={<ButtonLink href="/admin/competitions/new"><Plus /> Create Competition</ButtonLink>} />
      </>
    );
  }

  const { competition: comp, questions } = await listQuestions({ competitionId: ctx.selectedId });
  const clock = clockFor(comp);
  const lockedThroughDay = clock.phase === "ENDED" ? comp.durationDays : clock.phase === "ACTIVE" ? clock.currentDay! : 0;

  return (
    <>
      <PageHeader
        title="Questions"
        description="One question per day. Days that have opened are locked — use a correction to fix an answer key."
        actions={
          <Suspense>
            <CompetitionPicker options={ctx.options} value={ctx.selectedId} />
          </Suspense>
        }
      />
      <Suspense>
        <QuestionManager
          key={ctx.selectedId}
          comp={{
            id: String(comp._id),
            name: comp.name,
            status: comp.status,
            durationDays: comp.durationDays,
            lockedThroughDay,
            pointsPerCorrectAnswer: comp.scoring.pointsPerCorrectAnswer,
          }}
          questions={questions.map(toAdminQuestion)}
        />
      </Suspense>
    </>
  );
}
