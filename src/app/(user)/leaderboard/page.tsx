import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Lock, Trophy, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { COMPANY_TEAMS } from "@/lib/teams";
import { cn, plural } from "@/lib/utils";
import { getPublicLeaderboard, type LockedLeaderboard } from "@/services/leaderboard.service";

export const metadata: Metadata = { title: "Leaderboard" };

const PAGE_SIZE = 50;

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  const auth = await requireUser("/leaderboard");
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const teamFilter = typeof sp.team === "string" && sp.team.trim() && sp.team !== "All" ? sp.team.trim() : undefined;
  const href = (team?: string) => (team ? `/leaderboard?team=${encodeURIComponent(team)}` : "/leaderboard");

  let data: Awaited<ReturnType<typeof getPublicLeaderboard>>;
  try {
    data = await getPublicLeaderboard({ userId: auth.userId, page, pageSize: PAGE_SIZE, team: teamFilter });
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

  const { competition: c, entries, me, total, teamStandings } = data;
  const filterOptions = ["All", ...COMPANY_TEAMS.filter((t) => t !== "All")];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`🏆 ${c.name}`}
        title={teamFilter ? `${teamFilter} Team Leaderboard` : "Final Results"}
        description={
          teamFilter
            ? `${total} participant${total === 1 ? "" : "s"} in ${teamFilter} · ${c.durationDays} days`
            : `${total} participants across company · ${c.durationDays} days`
        }
      />

      {me && (
        <section aria-labelledby="your-result" className="space-y-3">
          <h2 id="your-result" className="text-lg font-semibold">Your result</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard
              label={teamFilter ? `${teamFilter} rank` : "Your rank"}
              value={`#${me.rank}`}
              hint={teamFilter && me.overallRank ? `Overall #${me.overallRank}` : undefined}
              className="border-primary/30 bg-primary-soft"
            />
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
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" aria-hidden />
              {teamFilter ? `${teamFilter} Participant Rankings` : "Individual Leaderboard"}
            </CardTitle>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
              Category:
            </span>
            {filterOptions.map((t) => {
              const isSelected = (!teamFilter && t === "All") || teamFilter === t;
              return (
                <Link
                  key={t}
                  href={t === "All" ? href() : href(t)}
                  className={cn(
                    "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                >
                  {t === "All" ? "All Teams" : t}
                </Link>
              );
            })}
          </div>
        </CardHeader>
        {entries.length === 0 ? (
          <CardContent>
            <EmptyState
              title={teamFilter ? `No participants in ${teamFilter}` : "No participants"}
              description={teamFilter ? `Nobody from the ${teamFilter} team joined this competition.` : "Nobody took part in this competition."}
            />
          </CardContent>
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH className="w-20">Rank</TH>
                  <TH>Participant</TH>
                  <TH>Team</TH>
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
                      <div>
                        {e.rank <= 3 ? ["🥇", "🥈", "🥉"][e.rank - 1] : `#${e.rank}`}
                        {teamFilter && e.overallRank && e.overallRank !== e.rank && (
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            All: #{e.overallRank}
                          </span>
                        )}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Avatar name={e.name} src={e.avatar} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{e.name}</span>
                            {e.isMe && <Badge tone="primary">You</Badge>}
                          </div>
                          {e.email && <span className="block truncate text-xs text-muted-foreground">{e.email}</span>}
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone="neutral">{e.team || "General"}</Badge>
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
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              basePath="/leaderboard"
              searchParams={teamFilter ? { team: teamFilter } : {}}
            />
          </>
        )}
      </Card>

      {teamStandings && teamStandings.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-5 text-primary" aria-hidden /> Company Team Standings
              </CardTitle>
              <span className="text-xs text-muted-foreground">Ranked by average score</span>
            </div>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH className="w-16">Rank</TH>
                <TH>Team</TH>
                <TH className="text-right">Participants</TH>
                <TH className="text-right">Avg Score</TH>
                <TH className="text-right">Total Points</TH>
                <TH className="text-right">Action</TH>
              </tr>
            </THead>
            <TBody>
              {teamStandings.map((ts) => (
                <TR key={ts.team} className={cn(teamFilter === ts.team && "bg-primary-soft/40")}>
                  <TD className="font-semibold tabular-nums">
                    {ts.rank <= 3 ? ["🥇", "🥈", "🥉"][ts.rank - 1] : `#${ts.rank}`}
                  </TD>
                  <TD className="font-medium">
                    <span className="flex items-center gap-2">
                      {ts.team}
                      {teamFilter === ts.team && <Badge tone="primary">Current View</Badge>}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{ts.totalParticipants}</TD>
                  <TD className="text-right font-semibold tabular-nums text-primary">{ts.avgScore}</TD>
                  <TD className="text-right tabular-nums text-muted-foreground">{ts.totalScore}</TD>
                  <TD className="text-right">
                    <Link
                      href={teamFilter === ts.team ? href() : href(ts.team)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {teamFilter === ts.team ? "View all" : "View team"}
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
