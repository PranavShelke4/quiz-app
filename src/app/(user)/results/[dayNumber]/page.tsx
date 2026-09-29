import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Lock, Minus, X } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { cn, formatDateTime } from "@/lib/utils";
import { getUserResults } from "@/services/leaderboard.service";

export async function generateMetadata({ params }: PageProps<"/results/[dayNumber]">): Promise<Metadata> {
  const { dayNumber } = await params;
  return { title: `Day ${dayNumber} review` };
}

export default async function ResultDayPage({ params }: PageProps<"/results/[dayNumber]">) {
  const { dayNumber } = await params;
  const day = Number(dayNumber);
  if (!Number.isInteger(day) || day < 1) notFound();
  const auth = await requireUser(`/results/${day}`);

  let data;
  try {
    data = await getUserResults(auth.userId);
  } catch (e) {
    if (isAppError(e) && (e.code === "LEADERBOARD_LOCKED" || e.code === "COMPETITION_NOT_FOUND")) {
      return <EmptyState icon={<Lock />} title="Results are hidden until the competition ends" action={<ButtonLink href="/dashboard">Back to dashboard</ButtonLink>} />;
    }
    throw e;
  }
  const d = data.days.find((x) => x.dayNumber === day);
  if (!d) notFound();
  const tz = data.competition.timezone;
  const total = data.days.length;

  return (
    <div className="mx-auto max-w-[700px] space-y-6">
      <div className="flex items-center justify-between">
        <ButtonLink href="/results" variant="ghost" size="sm">
          <ArrowLeft /> All results
        </ButtonLink>
        <span className="text-sm text-muted-foreground">
          Day {day} of {total}
        </span>
      </div>

      <Card>
        <CardContent className="space-y-5 pt-5 sm:pt-6">
          <div className="flex flex-wrap items-center gap-2">
            {d.result === "CORRECT" && <Badge tone="success"><Check className="size-3" aria-hidden /> Correct · +{d.points}</Badge>}
            {d.result === "WRONG" && <Badge tone="danger"><X className="size-3" aria-hidden /> Wrong · {d.points}</Badge>}
            {d.result === "MISSED" && <Badge><Minus className="size-3" aria-hidden /> Missed · 0</Badge>}
            <Badge>{d.category}</Badge>
            <Badge>{d.difficulty.toLowerCase()}</Badge>
          </div>
          <h1 className="text-xl font-semibold leading-snug">{d.questionText}</h1>
          <ul className="grid gap-2.5">
            {d.options.map((o) => {
              const isCorrect = o.id === d.correctOptionId;
              const isMine = o.id === d.selectedOptionId;
              return (
                <li
                  key={o.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-3",
                    isCorrect && "border-success/40 bg-success-soft",
                    isMine && !isCorrect && "border-danger/40 bg-danger-soft",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-sm font-semibold">{o.id}</span>
                  <span className="flex-1 text-sm">{o.text}</span>
                  {isCorrect && <span className="flex items-center gap-1 text-xs font-medium text-success"><Check className="size-3.5" aria-hidden /> Correct answer</span>}
                  {isMine && <span className="text-xs font-medium text-muted-foreground">Your answer</span>}
                </li>
              );
            })}
          </ul>
          <div className="rounded-xl bg-muted p-4 text-sm">
            <p className="font-medium">Correct answer: Option {d.correctOptionId}</p>
            {d.explanation && (
              <p className="mt-2 text-muted-foreground">
                <span className="font-medium text-foreground">Why: </span>
                {d.explanation}
              </p>
            )}
          </div>
          {d.answeredAt && <p className="text-xs text-muted-foreground">Answered {formatDateTime(d.answeredAt, tz)}</p>}
        </CardContent>
      </Card>

      <nav className="flex justify-between" aria-label="Day navigation">
        {day > 1 ? <ButtonLink href={`/results/${day - 1}`} variant="outline" size="sm"><ArrowLeft /> Day {day - 1}</ButtonLink> : <span />}
        {day < total ? <ButtonLink href={`/results/${day + 1}`} variant="outline" size="sm">Day {day + 1} <ArrowRight /></ButtonLink> : <span />}
      </nav>
    </div>
  );
}
