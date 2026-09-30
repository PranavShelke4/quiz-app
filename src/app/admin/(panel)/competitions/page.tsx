import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, Pencil, Plus } from "lucide-react";
import { CompetitionDeleteButton } from "@/components/admin/competition-delete-button";
import { FilterBar, FilterSelect, sp } from "@/components/admin/filter-bar";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDate } from "@/lib/utils";
import { COMPETITION_STATUSES, type CompetitionStatus } from "@/models/Competition";
import { listCompetitions } from "@/services/competition.service";

export const metadata: Metadata = { title: "Competitions" };

const STATUS_TONE: Record<CompetitionStatus, "neutral" | "primary" | "success" | "warning"> = {
  DRAFT: "warning",
  SCHEDULED: "primary",
  ACTIVE: "success",
  COMPLETED: "neutral",
  ARCHIVED: "neutral",
};

export default async function CompetitionsPage({ searchParams }: PageProps<"/admin/competitions">) {
  await requireAdmin("competitions:manage");
  const params = await searchParams;
  const status = COMPETITION_STATUSES.find((s) => s === sp(params.status));
  const page = Math.max(1, Number(sp(params.page) ?? 1) || 1);
  const { items, total } = await listCompetitions({ status, page, pageSize: 20 });

  return (
    <>
      <PageHeader title="Competitions" description="Create and schedule monthly competitions." actions={<ButtonLink href="/admin/competitions/new"><Plus /> Create Competition</ButtonLink>} />
      <FilterBar action="/admin/competitions" resetHref="/admin/competitions">
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "", label: "All" }, ...COMPETITION_STATUSES.map((s) => ({ value: s, label: s }))]} />
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState icon={<CalendarRange />} title="No competitions yet" description="Create your first competition to get started." action={<ButtonLink href="/admin/competitions/new"><Plus /> Create Competition</ButtonLink>} />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Status</TH>
                <TH>Dates</TH>
                <TH className="text-right">Questions</TH>
                <TH className="text-right">Participants</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {items.map(({ competition: c, clock, publishedQuestions, questions, participants }) => (
                <TR key={String(c._id)}>
                  <TD>
                    <Link href={`/admin/competitions/${String(c._id)}`} className="font-medium hover:underline">{c.name}</Link>
                    <p className="text-xs text-muted-foreground">{c.timezone}</p>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                    {clock.phase === "ACTIVE" && <span className="ml-2 text-xs text-muted-foreground">Day {clock.currentDay}/{c.durationDays}</span>}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">
                    {formatDate(c.startDate, c.timezone)} – {formatDate(new Date(c.endDate.getTime() - 1), c.timezone)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    <span className={publishedQuestions < c.durationDays ? "text-warning" : ""}>{publishedQuestions}</span>/{c.durationDays}
                    {questions > publishedQuestions && <span className="block text-xs text-muted-foreground">{questions - publishedQuestions} draft</span>}
                  </TD>
                  <TD className="text-right tabular-nums">{participants}</TD>
                  <TD className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <ButtonLink href={`/admin/competitions/${String(c._id)}`} variant="ghost" size="icon" aria-label={`View or edit ${c.name}`} title="View or edit">
                        <Pencil className="size-4" />
                      </ButtonLink>
                      <CompetitionDeleteButton id={String(c._id)} name={c.name} variant="ghost" size="icon" className="text-danger hover:text-danger hover:bg-danger-soft" />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={20} total={total} basePath="/admin/competitions" searchParams={{ status }} />
        </Card>
      )}
    </>
  );
}
