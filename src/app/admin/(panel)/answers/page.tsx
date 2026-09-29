import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Download } from "lucide-react";
import { FilterBar, FilterDate, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { DownloadButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, Input, PageHeader } from "@/components/ui/primitives";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { answerFiltersSchema } from "@/lib/validation/admin";
import { paginationSchema, toPlainObject } from "@/lib/validation/common";
import { formatDateTime } from "@/lib/utils";
import { listAnswers } from "@/services/answers.service";
import { listCompetitionOptions } from "@/services/competition.service";

export const metadata: Metadata = { title: "Answers" };

const schema = answerFiltersSchema.extend(paginationSchema.shape);

export default async function AdminAnswersPage({ searchParams }: PageProps<"/admin/answers">) {
  await requireAdmin("answers:view");
  const raw = toPlainObject(await searchParams);
  const parsed = schema.safeParse(raw);
  const q = parsed.success ? parsed.data : schema.parse({});
  const [{ items, total }, comps] = await Promise.all([listAnswers(q, q.page, q.pageSize), listCompetitionOptions()]);
  const { page: _p, pageSize: _ps, ...filters } = q;
  void _p;
  void _ps;
  const filterQs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  const keep = Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v === undefined ? undefined : String(v)]));

  return (
    <>
      <PageHeader
        title="Answers"
        description="Every recorded answer, including correctness (admin only)."
        actions={<DownloadButton href={`/api/admin/answers/export?${filterQs}`}><Download /> Export CSV</DownloadButton>}
      />
      <FilterBar action="/admin/answers" resetHref="/admin/answers">
        <FilterSelect name="competitionId" label="Competition" value={q.competitionId} options={[{ value: "", label: "All" }, ...comps.map((c) => ({ value: String(c._id), label: c.name }))]} />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Day
          <Input type="number" name="day" min={1} max={90} defaultValue={q.day} className="h-10 w-20 text-foreground" />
        </label>
        <SearchInput name="user" defaultValue={q.user} placeholder="User name or email" />
        <FilterSelect name="status" label="Status" value={q.status} options={[{ value: "", label: "Any" }, { value: "ANSWERED", label: "Answered" }, { value: "MISSED", label: "Missed" }]} />
        <FilterSelect name="correctness" label="Result" value={q.correctness} options={[{ value: "", label: "Any" }, { value: "correct", label: "Correct" }, { value: "incorrect", label: "Incorrect" }]} />
        <FilterDate name="from" label="From" value={q.from} />
        <FilterDate name="to" label="To" value={q.to} />
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No answers found" description="Try changing the filters." />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Day</TH>
                <TH className="hidden xl:table-cell">Question</TH>
                <TH>Selected</TH>
                <TH className="hidden md:table-cell">Correct</TH>
                <TH>Result</TH>
                <TH className="text-right">Score</TH>
                <TH className="hidden lg:table-cell">Timestamp</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/admin/users/${a.userId}`} className="font-medium hover:underline">{a.userName}</Link>
                    <p className="text-xs text-muted-foreground">{a.competition}</p>
                  </TD>
                  <TD className="tabular-nums">{a.dayNumber}</TD>
                  <TD className="hidden max-w-xs xl:table-cell"><p className="line-clamp-2 text-xs">{a.question}</p></TD>
                  <TD className="max-w-40 truncate text-xs">{a.selectedAnswer || "—"}</TD>
                  <TD className="hidden max-w-40 truncate text-xs md:table-cell">{a.correctAnswer}</TD>
                  <TD>
                    {a.status === "MISSED" ? <Badge>Missed</Badge> : a.isCorrect ? <Badge tone="success">Correct</Badge> : <Badge tone="danger">Incorrect</Badge>}
                    {a.corrected && <Badge tone="warning" className="ml-1">Corrected</Badge>}
                  </TD>
                  <TD className="text-right tabular-nums">{a.score}</TD>
                  <TD className="hidden text-xs lg:table-cell">{formatDateTime(a.answeredAt ?? a.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={q.page} pageSize={q.pageSize} total={total} basePath="/admin/answers" searchParams={keep} />
        </Card>
      )}
    </>
  );
}
