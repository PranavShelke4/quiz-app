import type { Metadata } from "next";
import { AlertTriangle, CalendarRange, Download, FileQuestion, Plus, Trophy, Upload, Users } from "lucide-react";
import Link from "next/link";
import { ParticipationChart, PercentLineChart, RegistrationChart } from "@/components/admin/charts";
import { ButtonLink, DownloadButton } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDate, formatNumber } from "@/lib/utils";
import { getAdminDashboard } from "@/services/analytics.service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  await requireAdmin("analytics:view");
  const d = await getAdminDashboard();
  const c = d.competition;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Competition health at a glance."
        actions={
          <>
            <ButtonLink href="/admin/competitions/new" size="sm"><Plus /> Create Competition</ButtonLink>
            <ButtonLink href={c ? `/admin/questions?competitionId=${c.id}&new=1` : "/admin/questions"} size="sm" variant="outline"><FileQuestion /> Add Question</ButtonLink>
            <ButtonLink href={c ? `/admin/questions?competitionId=${c.id}&import=1` : "/admin/questions"} size="sm" variant="outline"><Upload /> Import Questions</ButtonLink>
          </>
        }
      />

      {d.openFlags > 0 && (
        <Alert tone="warning" title={`${d.openFlags} anti-cheat flag${d.openFlags === 1 ? "" : "s"} awaiting review`} action={<ButtonLink href="/admin/flags" size="sm" variant="outline">Review</ButtonLink>}>
          Heuristic signals only — nothing has been changed automatically.
        </Alert>
      )}

      {!c ? (
        <EmptyState
          icon={<CalendarRange />}
          title="No competition is currently active."
          description="Create your first competition to get started."
          action={<ButtonLink href="/admin/competitions/new"><Plus /> Create Competition</ButtonLink>}
        />
      ) : (
        <Card>
          <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardDescription>Current competition</CardDescription>
              <CardTitle className="text-xl">
                <Link href={`/admin/competitions/${c.id}`} className="hover:underline">{c.name}</Link>
              </CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.phase === "ACTIVE" ? "success" : c.phase === "NOT_STARTED" ? "primary" : "neutral"}>{c.status}</Badge>
              {c.phase === "ACTIVE" && <Badge>Day {c.currentDay} / {c.durationDays}</Badge>}
              <ButtonLink href={`/admin/leaderboard?competitionId=${c.id}`} size="sm" variant="outline"><Trophy /> View Leaderboard</ButtonLink>
              <DownloadButton href={`/api/admin/leaderboard/export?competitionId=${c.id}`}><Download /> Export Results</DownloadButton>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <StatCard label="Start date" value={<span className="text-base">{formatDate(c.startsAt, c.timezone)}</span>} />
            <StatCard label="End date" value={<span className="text-base">{formatDate(new Date(Date.parse(c.endsAt) - 1), c.timezone)}</span>} />
            <StatCard label="Registered" value={formatNumber(c.registered)} />
            <StatCard label="Active (7d)" value={formatNumber(c.activeParticipants)} />
            <StatCard label="Answers today" value={formatNumber(c.answersToday)} />
            <StatCard label="Missed yesterday" value={formatNumber(c.missedYesterday)} />
            <StatCard label="Avg participation" value={`${c.averageParticipation}%`} />
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="user-stats" className="space-y-3">
        <h2 id="user-stats" className="flex items-center gap-2 font-semibold"><Users className="size-4" aria-hidden /> Users</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Total users" value={formatNumber(d.users.totalUsers)} />
          <StatCard label="Verified" value={formatNumber(d.users.verifiedUsers)} />
          <StatCard label="Active (30d)" value={formatNumber(d.users.activeUsers)} />
          <StatCard label="Disabled" value={formatNumber(d.users.inactiveUsers)} />
          <StatCard label="New today" value={formatNumber(d.users.newToday)} />
          <StatCard label="New this week" value={formatNumber(d.users.newWeek)} />
        </div>
      </section>

      {d.quiz && (
        <section aria-labelledby="quiz-stats" className="space-y-3">
          <h2 id="quiz-stats" className="flex items-center gap-2 font-semibold"><FileQuestion className="size-4" aria-hidden /> Quiz</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <StatCard label="Questions created" value={d.quiz.questionsCreated} />
            <StatCard label="Published" value={d.quiz.questionsPublished} />
            <StatCard label="Today's answers" value={d.quiz.todaysAnswers} />
            <StatCard label="Total answers" value={formatNumber(d.quiz.totalAnswers)} />
            <StatCard label="Missed answers" value={formatNumber(d.quiz.missedAnswers)} />
            <StatCard label="Avg accuracy" value={`${d.quiz.averageAccuracy}%`} hint="Admin-only" />
            <StatCard label="Avg participation" value={`${d.quiz.averageParticipation}%`} />
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {d.charts && d.charts.participation.length > 0 && (
          <>
            <Card>
              <CardHeader><CardTitle>Answers & misses per day</CardTitle></CardHeader>
              <CardContent><ParticipationChart data={d.charts.participation} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Participation by day</CardTitle></CardHeader>
              <CardContent><PercentLineChart data={d.charts.participation} label="Participation percentage by day" /></CardContent>
            </Card>
          </>
        )}
        <Card>
          <CardHeader><CardTitle>Registration growth (30 days)</CardTitle></CardHeader>
          <CardContent><RegistrationChart data={d.registrations} /></CardContent>
        </Card>
        {c && (
          <Card>
            <CardHeader><CardTitle>More insights</CardTitle><CardDescription>Score distribution, difficulty and category performance.</CardDescription></CardHeader>
            <CardContent>
              <ButtonLink href={`/admin/analytics?competitionId=${c.id}`} variant="outline"><AlertTriangle /> Open analytics</ButtonLink>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
