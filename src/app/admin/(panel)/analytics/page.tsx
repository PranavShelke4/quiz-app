import type { Metadata } from "next";
import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { ParticipationChart, PercentLineChart, SimpleBarChart } from "@/components/admin/charts";
import { CompetitionPicker } from "@/components/admin/competition-picker";
import { sp } from "@/components/admin/filter-bar";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { resolveCompetitionContext } from "@/lib/admin/competition-context";
import { requireAdmin } from "@/lib/auth/dal";
import { getCompetitionAnalytics } from "@/services/analytics.service";
import { getCompetitionById } from "@/services/competition.service";

export const metadata: Metadata = { title: "Analytics" };

const SIGNAL = {
  TOO_EASY: { label: "Too easy", tone: "warning" },
  TOO_HARD: { label: "Too hard", tone: "danger" },
  NORMAL: { label: "Normal", tone: "neutral" },
  NO_DATA: { label: "Not enough data", tone: "neutral" },
} as const;

export default async function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  await requireAdmin("analytics:view");
  const params = await searchParams;
  const ctx = await resolveCompetitionContext(sp(params.competitionId));
  if (!ctx.selectedId) return <EmptyState icon={<BarChart3 />} title="No competition yet" description="Analytics appear once a competition has participants." />;
  const comp = await getCompetitionById(ctx.selectedId);
  const a = await getCompetitionAnalytics(comp);
  const registered = a.dropOff[0]?.value ?? 0;

  return (
    <>
      <PageHeader title="Analytics" description={comp.name} actions={<Suspense><CompetitionPicker options={ctx.options} value={ctx.selectedId} /></Suspense>} />

      {a.participation.days.length === 0 ? (
        <EmptyState icon={<BarChart3 />} title="No data yet" description="Charts fill in once the competition starts." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Daily participation</CardTitle><CardDescription>Share of registered participants answering each day.</CardDescription></CardHeader>
            <CardContent><PercentLineChart data={a.participation.days} label="Daily participation percentage" /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Answers vs misses per day</CardTitle></CardHeader>
            <CardContent><ParticipationChart data={a.participation.days} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Drop-off</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {a.dropOff.map((d) => (
                <div key={d.label} className="space-y-1">
                  <div className="flex justify-between text-sm"><span>{d.label}</span><span className="tabular-nums">{d.value} {registered ? `(${Math.round((d.value / registered) * 100)}%)` : ""}</span></div>
                  <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${registered ? (d.value / registered) * 100 : 0}%` }} /></div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Score distribution</CardTitle></CardHeader>
            <CardContent><SimpleBarChart data={a.scoreDistribution} xKey="score" yKey="count" label="Participants by total score" /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Accuracy by difficulty</CardTitle></CardHeader>
            <CardContent><SimpleBarChart data={a.byDifficulty} xKey="name" yKey="accuracy" unit="%" label="Accuracy by difficulty" height={220} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Accuracy by category</CardTitle></CardHeader>
            <CardContent><SimpleBarChart data={a.byCategory} xKey="name" yKey="accuracy" unit="%" label="Accuracy by category" height={220} /></CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Question performance</CardTitle><CardDescription>Spot questions that are too easy (≥90%) or too hard (≤20%).</CardDescription></CardHeader>
        <Table>
          <THead>
            <tr><TH>Day</TH><TH>Question</TH><TH className="text-right">Attempts</TH><TH className="text-right">Correct</TH><TH className="text-right">Wrong</TH><TH className="text-right">Missed</TH><TH className="text-right">Accuracy</TH><TH>Signal</TH></tr>
          </THead>
          <TBody>
            {a.performance.map((q) => (
              <TR key={q.id}>
                <TD className="tabular-nums">{q.dayNumber}</TD>
                <TD className="max-w-sm"><p className="line-clamp-2 text-sm">{q.questionText}</p><p className="text-xs text-muted-foreground">{q.category} · {q.difficulty}</p></TD>
                <TD className="text-right tabular-nums">{q.attempts}</TD>
                <TD className="text-right tabular-nums">{q.correct}</TD>
                <TD className="text-right tabular-nums">{q.wrong}</TD>
                <TD className="text-right tabular-nums">{q.missed}</TD>
                <TD className="text-right tabular-nums">{q.attempts ? `${q.accuracy}%` : "—"}</TD>
                <TD><Badge tone={SIGNAL[q.signal].tone}>{SIGNAL[q.signal].label}</Badge></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
