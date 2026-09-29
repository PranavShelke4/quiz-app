import type { Metadata } from "next";
import { Lock, Trophy } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { cn, plural } from "@/lib/utils";
import { getPublicLeaderboard, type LockedLeaderboard } from "@/services/leaderboard.service";

export const metadata: Metadata = { title: "Leaderboard" };

const PAGE_SIZE = 50;

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  const auth = await requireUser("/leaderboard");
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);

  let data: Awaited<ReturnType<typeof getPublicLeaderboard>>;
  try {
    data = await getPublicLeaderboard({ userId: auth.userId, page, pageSize: PAGE_SIZE });
  } catch (e) {
    if (isAppError(e) && e.code === "LEADERBOARD_LOCKED") {
      const d = e.details as LockedLeaderboard;
      return (
        <div className="mx-auto max-w-xl py-10 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
            <Lock className="size-7" aria-hidden />
          </div>
          <h1 className="mt-6 text-2xl font-semibold">🏆 Leaderboard Locked</h1>
          <p className="mt-3 text-muted-foreground">The final leaderboard will be revealed after the competition ends.</p>
          {d.phase === "ACTIVE" && (
            <>
              <p className="mt-2 text-muted-foreground">Keep answering every day.</p>
              <p className="mt-4 font-medium">{plural(d.daysRemaining, "day")} remaining after today.</p>
            </>
          )}
          {d.phase === "ENDED" && <p className="mt-2 text-muted-foreground">The competition has ended — results will be published shortly.</p>}
          <ButtonLink href="/quiz" className="mt-6">
            Go to today&apos;s quiz
          </ButtonLink>
        </div>
      );
    }
    if (isAppError(e) && e.code === "COMPETITION_NOT_FOUND") {
      return <EmptyState icon={<Trophy />} title="No competition yet" description="The leaderboard appears once a competition has run." />;
    }
    throw e;
  }

  const { competition: c, entries, me, total } = data;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={`🏆 ${c.name}`} title="Final Results" description={`${total} participants · ${c.durationDays} days`} />

      {me && (
        <section aria-labelledby="your-result" className="space-y-3">
          <h2 id="your-result" className="text-lg font-semibold">Your result</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Your rank" value={`#${me.rank}`} className="border-primary/30 bg-primary-soft" />
            <StatCard label="Score" value={me.score} />
            <StatCard label="Correct" value={me.correct} />
            <StatCard label="Wrong" value={me.wrong} />
            <StatCard label="Missed" value={me.missed} />
          </div>
          <ButtonLink href="/results" variant="outline" size="sm">
            Review your {c.durationDays}-day journey
          </ButtonLink>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Leaderboard</CardTitle>
        </CardHeader>
        {entries.length === 0 ? (
          <CardContent>
            <EmptyState title="No participants" description="Nobody took part in this competition." />
          </CardContent>
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH className="w-16">Rank</TH>
                  <TH>Participant</TH>
                  <TH className="text-right">Score</TH>
                  <TH className="hidden text-right sm:table-cell">Correct</TH>
                  <TH className="hidden text-right sm:table-cell">Wrong</TH>
                  <TH className="hidden text-right sm:table-cell">Missed</TH>
                  <TH className="hidden text-right md:table-cell">Accuracy</TH>
                  <TH className="hidden text-right lg:table-cell">Completion</TH>
                  <TH className="hidden text-right lg:table-cell">Best streak</TH>
                </tr>
              </THead>
              <TBody>
                {entries.map((e, i) => (
                  <TR key={`${e.rank}-${i}`} className={cn(e.isMe && "bg-primary-soft/60")}>
                    <TD className="font-semibold tabular-nums">
                      {e.rank <= 3 ? ["🥇", "🥈", "🥉"][e.rank - 1] : `#${e.rank}`}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Avatar name={e.name} src={e.avatar} />
                        <span className="font-medium">{e.name}</span>
                        {e.isMe && <Badge tone="primary">You</Badge>}
                      </div>
                    </TD>
                    <TD className="text-right font-semibold tabular-nums">{e.score}</TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{e.correct}</TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{e.wrong}</TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{e.missed}</TD>
                    <TD className="hidden text-right tabular-nums md:table-cell">{e.accuracy}%</TD>
                    <TD className="hidden text-right tabular-nums lg:table-cell">{e.completion}%</TD>
                    <TD className="hidden text-right tabular-nums lg:table-cell">{e.longestStreak}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/leaderboard" searchParams={{}} />
          </>
        )}
      </Card>
    </div>
  );
}
