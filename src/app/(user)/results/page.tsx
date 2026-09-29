import type { Metadata } from "next";
import Link from "next/link";
import { Check, Lock, Minus, X } from "lucide-react";
import { ProgressCalendar } from "@/components/quiz/progress-calendar";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { getUserResults } from "@/services/leaderboard.service";

export const metadata: Metadata = { title: "Your results" };

async function loadResults(userId: Parameters<typeof getUserResults>[0]) {
  try {
    return { data: await getUserResults(userId) };
  } catch (e) {
    if (isAppError(e) && (e.code === "LEADERBOARD_LOCKED" || e.code === "COMPETITION_NOT_FOUND")) return { locked: true as const };
    throw e;
  }
}

export default async function ResultsPage() {
  const auth = await requireUser("/results");
  const res = await loadResults(auth.userId);
  if ("locked" in res) {
    return (
      <EmptyState
        icon={<Lock />}
        title="Results are hidden until the competition ends"
        description="Once the final leaderboard is revealed you can review every question, your answer and the correct answer."
        action={<ButtonLink href="/dashboard">Back to dashboard</ButtonLink>}
      />
    );
  }
  const { competition: c, summary, days } = res.data;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={`🏆 ${c.name}`} title="Your results" description="Review every question, the correct answer and why." />
      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Rank" value={summary.rank ? `#${summary.rank}` : "—"} hint={`of ${summary.totalParticipants}`} className="border-primary/30 bg-primary-soft" />
          <StatCard label="Score" value={`${summary.score} / ${summary.maxScore}`} />
          <StatCard label="Correct" value={summary.correct} />
          <StatCard label="Wrong" value={summary.wrong} />
          <StatCard label="Missed" value={summary.missed} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You didn&apos;t take part in this competition, but you can still review the questions.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your {c.durationDays}-day journey</CardTitle>
        </CardHeader>
        <CardContent>
          <ProgressCalendar revealed linkBase="/results" days={days.map((d) => ({ dayNumber: d.dayNumber, state: d.result }))} />
        </CardContent>
      </Card>

      <Card>
        <ul className="divide-y">
          {days.map((d) => (
            <li key={d.dayNumber}>
              <Link href={`/results/${d.dayNumber}`} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/50 sm:px-6">
                <span className="w-14 shrink-0 text-sm text-muted-foreground">Day {d.dayNumber}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.questionText}</span>
                {d.result === "CORRECT" && <Badge tone="success"><Check className="size-3" aria-hidden /> Correct</Badge>}
                {d.result === "WRONG" && <Badge tone="danger"><X className="size-3" aria-hidden /> Wrong</Badge>}
                {d.result === "MISSED" && <Badge><Minus className="size-3" aria-hidden /> Missed</Badge>}
                <span className="w-12 text-right text-sm tabular-nums">{d.points > 0 ? `+${d.points}` : d.points}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
