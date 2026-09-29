import type { Metadata } from "next";
import { CalendarClock, CheckCircle2, Hourglass, Trophy } from "lucide-react";
import { Countdown } from "@/components/countdown";
import { nextQuestionLabel } from "@/components/quiz/format";
import { JoinButton } from "@/components/quiz/join-button";
import { ProgressCalendar } from "@/components/quiz/progress-calendar";
import { QuizCard } from "@/components/quiz/quiz-card";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, EmptyState, Progress, StatCard } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/dal";
import { plural } from "@/lib/utils";
import { getQuizState } from "@/services/quiz.service";

export const metadata: Metadata = { title: "Today's quiz" };

export default async function QuizPage() {
  const auth = await requireUser("/quiz");
  const state = await getQuizState(auth.userId);
  const c = state.competition;

  if (!c) {
    return <EmptyState icon={<Trophy />} title="No competition is currently active." description="Check back soon for the next challenge." />;
  }

  if (c.phase === "NOT_STARTED") {
    return (
      <div className="mx-auto max-w-2xl space-y-6 text-center">
        <CalendarClock className="mx-auto size-10 text-primary" aria-hidden />
        <h1 className="text-2xl font-semibold">{c.name} hasn&apos;t started yet</h1>
        <p className="text-muted-foreground">The first question unlocks in</p>
        <div className="flex justify-center">
          <Countdown target={c.startsAt} serverTime={c.serverTime} />
        </div>
        {!state.isParticipant && state.canJoin && <JoinButton disabled={!state.emailVerified} />}
      </div>
    );
  }

  if (c.phase === "ENDED") {
    return (
      <EmptyState
        icon={<Trophy />}
        title="Competition completed"
        description={c.leaderboardRevealed ? "Results are out — see how you did." : "Thanks for playing! Results will be revealed soon."}
        action={<ButtonLink href={c.leaderboardRevealed ? "/results" : "/leaderboard"}>{c.leaderboardRevealed ? "View results" : "Leaderboard"}</ButtonLink>}
      />
    );
  }

  const today = state.today!;
  const p = state.progress;
  const label = nextQuestionLabel(state.nextQuestionAt, c.serverTime, c.timezone);

  let blockedReason: string | undefined;
  if (!state.emailVerified) blockedReason = "Verify your email address to submit answers.";
  else if (!state.isParticipant && !state.canJoin) blockedReason = "Registration for this competition is closed.";

  return (
    <div className="mx-auto max-w-[700px] space-y-6">
      <header className="space-y-3">
        <p className="text-sm font-medium text-primary">{c.name}</p>
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Day {c.currentDay} <span className="text-muted-foreground">/ {c.durationDays}</span>
          </h1>
          <p className="text-sm text-muted-foreground">{plural(c.daysRemaining, "day")} remaining</p>
        </div>
        <Progress value={((c.currentDay ?? 0) / c.durationDays) * 100} label="Competition progress" />
      </header>

      {today.status === "UNAVAILABLE" ? (
        <EmptyState icon={<Hourglass />} title="Today's question isn't available yet" description="Please check back shortly." />
      ) : (
        <QuizCard
          key={today.question.id}
          question={today.question}
          status={today.status}
          selectedOptionId={today.status === "ANSWERED" ? today.selectedOptionId : undefined}
          submittedAt={today.status === "ANSWERED" ? today.submittedAt : undefined}
          closesAt={today.closesAt}
          serverTime={c.serverTime}
          nextQuestionLabel={label}
          canSubmit={!blockedReason}
          blockedReason={blockedReason}
        />
      )}

      {today.status === "ANSWERED" && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4" aria-hidden /> Today&apos;s question completed.
        </p>
      )}

      {p && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Answered" value={`${p.answered}/${p.eligibleDays}`} />
            <StatCard label="Missed" value={p.missed} />
            <StatCard label="Streak" value={`🔥 ${p.currentStreak}`} />
          </div>
          <Card>
            <CardContent className="pt-5 sm:pt-6">
              <ProgressCalendar days={p.days} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
