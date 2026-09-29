import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Download, Trophy } from "lucide-react";
import { CompetitionPicker } from "@/components/admin/competition-picker";
import { FilterBar, FilterSelect, SearchInput, sp } from "@/components/admin/filter-bar";
import { LeaderboardActions } from "@/components/admin/leaderboard-actions";
import { DownloadButton } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { resolveCompetitionContext } from "@/lib/admin/competition-context";
import { requireAdmin } from "@/lib/auth/dal";
import { adminLeaderboardQuery } from "@/lib/validation/admin";
import { clockFor, isLeaderboardRevealed } from "@/services/competition.service";
import { getAdminLeaderboard } from "@/services/leaderboard.service";

export const metadata: Metadata = { title: "Leaderboard" };

export default async function AdminLeaderboardPage({ searchParams }: PageProps<"/admin/leaderboard">) {
  await requireAdmin("leaderboard:manage");
  const params = await searchParams;
  const ctx = await resolveCompetitionContext(sp(params.competitionId));
  if (!ctx.selectedId) return <EmptyState icon={<Trophy />} title="No competition yet" />;

  const parsed = adminLeaderboardQuery.safeParse({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === "string" && v)), competitionId: ctx.selectedId });
  const q = parsed.success ? parsed.data : adminLeaderboardQuery.parse({ competitionId: ctx.selectedId });
  const { competition: comp, rows, total } = await getAdminLeaderboard(q);
  const clock = clockFor(comp);
  const revealed = isLeaderboardRevealed(comp);
  const pageSize = q.pageSize;

  return (
    <>
      <PageHeader
        title="Leaderboard"
        description={comp.finalizedAt ? "Final, frozen ranking." : "Live standings (admin preview) using the competition's tie-breakers."}
        actions={
          <>
            <Suspense><CompetitionPicker options={ctx.options} value={ctx.selectedId} /></Suspense>
            <DownloadButton href={`/api/admin/leaderboard/export?competitionId=${ctx.selectedId}`}><Download /> {comp.finalizedAt ? "Export final results" : "Export CSV"}</DownloadButton>
            <LeaderboardActions competitionId={ctx.selectedId} name={comp.name} revealed={comp.leaderboardRevealed} ended={clock.phase === "ENDED"} />
          </>
        }
      />
      <Alert tone={revealed ? "success" : "info"} title={revealed ? "Publicly revealed" : "Not visible to participants"}>
        {revealed
          ? "Participants can see final ranks, scores and answers."
          : clock.phase === "ENDED"
            ? comp.leaderboardRevealMode === "AUTOMATIC" && !comp.leaderboardRevealOverridden
              ? "Will be revealed automatically at the configured reveal time."
              : "Reveal it manually when you're ready."
            : "Participants see a locked leaderboard until the competition ends. This preview is confidential."}
      </Alert>

      <FilterBar action="/admin/leaderboard" resetHref={`/admin/leaderboard?competitionId=${ctx.selectedId}`}>
        <input type="hidden" name="competitionId" value={ctx.selectedId} />
        <SearchInput defaultValue={q.search} placeholder="Search participant" />
        <FilterSelect name="sort" label="Sort by" value={q.sort} options={["rank", "score", "correct", "wrong", "missed", "accuracy", "streak"].map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))} />
        <FilterSelect name="dir" label="Order" value={q.dir} options={[{ value: "", label: "Default" }, { value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]} />
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState icon={<Trophy />} title="No participants yet" />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Rank</TH><TH>Participant</TH><TH className="text-right">Score</TH><TH className="text-right">Correct</TH><TH className="text-right">Wrong</TH>
                <TH className="text-right">Missed</TH><TH className="hidden text-right md:table-cell">Accuracy</TH><TH className="hidden text-right md:table-cell">Completion</TH><TH className="hidden text-right lg:table-cell">Streak</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.userId}>
                  <TD className="font-semibold tabular-nums">#{r.rank}</TD>
                  <TD>
                    <Link href={`/admin/users/${r.userId}`} className="font-medium hover:underline">{r.name}</Link>
                    <p className="text-xs text-muted-foreground">{r.email}</p>
                    {!r.isActive && <Badge tone="danger">Disabled</Badge>}
                  </TD>
                  <TD className="text-right font-semibold tabular-nums">{r.score}</TD>
                  <TD className="text-right tabular-nums">{r.correct}</TD>
                  <TD className="text-right tabular-nums">{r.wrong}</TD>
                  <TD className="text-right tabular-nums">{r.missed}</TD>
                  <TD className="hidden text-right tabular-nums md:table-cell">{r.accuracy}%</TD>
                  <TD className="hidden text-right tabular-nums md:table-cell">{r.completion}%</TD>
                  <TD className="hidden text-right tabular-nums lg:table-cell">{r.currentStreak} / {r.longestStreak}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={q.page} pageSize={pageSize} total={total} basePath="/admin/leaderboard" searchParams={{ competitionId: ctx.selectedId, search: q.search, sort: q.sort, dir: q.dir }} />
        </Card>
      )}
    </>
  );
}
