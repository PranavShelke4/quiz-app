import type { Metadata } from "next";
import { ArrowRight, CalendarCheck, CalendarX, CheckCircle2, Flame, Lock, Trophy } from "lucide-react";
import { Countdown } from "@/components/countdown";
import { NotificationsPanel } from "@/components/notifications-panel";
import { JoinButton } from "@/components/quiz/join-button";
import { ProgressCalendar } from "@/components/quiz/progress-calendar";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/dal";
import { formatDate, plural } from "@/lib/utils";
import { getQuizState } from "@/services/quiz.service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const auth = await requireUser("/dashboard");
  const state = await getQuizState(auth.userId);
  const c = state.competition;
  const firstName = auth.user.name.split(" ")[0];

  if (!c) {
    return (
      <div className="space-y-8">
        <PageHeader title={`Welcome, ${firstName}`} />
        <EmptyState icon={<Trophy />} title="No competition is currently active." description="We'll let you know as soon as the next competition opens." />
      </div>
    );
  }

  const p = state.progress;
  const today = state.today;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={c.name}
        title={`Welcome, ${firstName}`}
        description={
          c.phase === "ACTIVE" ? `Day ${c.currentDay} of ${c.durationDays}` : c.phase === "NOT_STARTED" ? `Starts ${formatDate(c.startsAt, c.timezone)}` : "Competition completed"
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s quiz</CardTitle>
            <CardDescription>
              {c.phase === "ACTIVE" && `Day ${c.currentDay} / ${c.durationDays}`}
              {c.phase === "NOT_STARTED" && "The first question unlocks when the competition starts."}
              {c.phase === "ENDED" && "The competition has finished."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!state.isParticipant && state.canJoin && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">You haven&apos;t joined {c.name} yet.</p>
                <JoinButton />
              </div>
            )}
            {!state.isParticipant && !state.canJoin && c.phase !== "ENDED" && (
              <p className="text-sm text-muted-foreground">Registration for this competition is closed.</p>
            )}
            {c.phase === "NOT_STARTED" && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Competition starts in</p>
                <Countdown target={c.startsAt} serverTime={c.serverTime} />
              </div>
            )}
            {c.phase === "ACTIVE" && today?.status === "OPEN" && (state.isParticipant || state.canJoin) && (
              <div className="flex flex-wrap items-center gap-3">
                <ButtonLink href="/quiz" size="lg">
                  Start Quiz <ArrowRight />
                </ButtonLink>
                <span className="text-sm text-muted-foreground">
                  Closes in <Countdown compact target={today.closesAt} serverTime={c.serverTime} />
                </span>
              </div>
            )}
            {c.phase === "ACTIVE" && today?.status === "ANSWERED" && (
              <div className="flex items-center gap-2 rounded-lg bg-primary-soft p-3 text-sm text-primary-soft-foreground">
                <CheckCircle2 className="size-4" aria-hidden /> Today&apos;s question completed. See you tomorrow!
              </div>
            )}
            {c.phase === "ACTIVE" && today?.status === "UNAVAILABLE" && <p className="text-sm text-muted-foreground">Today&apos;s question isn&apos;t available yet.</p>}
            {c.phase === "ENDED" && (
              <ButtonLink href={c.leaderboardRevealed ? "/results" : "/leaderboard"}>
                {c.leaderboardRevealed ? "See your results" : "Leaderboard status"} <ArrowRight />
              </ButtonLink>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Leaderboard {c.leaderboardRevealed ? <Badge tone="success">Revealed</Badge> : <Badge><Lock className="size-3" aria-hidden /> Locked</Badge>}
            </CardTitle>
            <CardDescription>
              {c.leaderboardRevealed ? "Final results are available." : "Scores and ranks are revealed after the competition ends."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.phase === "ACTIVE" && (
              <p className="text-sm">
                Competition ends in <span className="font-semibold">{plural(c.daysRemaining + 1, "day")}</span>
                <span className="text-muted-foreground"> (including today)</span>
              </p>
            )}
            <ButtonLink href="/leaderboard" variant="outline" size="sm">
              <Trophy /> {c.leaderboardRevealed ? "View leaderboard" : "Leaderboard"}
            </ButtonLink>
          </CardContent>
        </Card>
      </div>

      {p && (
        <>
          <section aria-labelledby="participation" className="space-y-3">
            <h2 id="participation" className="text-lg font-semibold">Participation</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Answered" value={`${p.answered}/${p.eligibleDays || c.durationDays}`} icon={<CalendarCheck />} />
              <StatCard label="Missed" value={p.missed} icon={<CalendarX />} />
              <StatCard label="Current streak" value={<span className="flex items-center gap-1">🔥 {plural(p.currentStreak, "day")}</span>} icon={<Flame />} />
              <StatCard label="Longest streak" value={plural(p.longestStreak, "day")} icon={<Flame />} />
            </div>
          </section>
          <Card>
            <CardHeader>
              <CardTitle>Your {c.durationDays}-day journey</CardTitle>
              <CardDescription>Participation only — correctness stays hidden until results are revealed.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProgressCalendar days={p.days} />
            </CardContent>
          </Card>
        </>
      )}

      <NotificationsPanel />
    </div>
  );
}
