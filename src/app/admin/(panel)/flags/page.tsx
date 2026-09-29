import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { FilterBar, FilterSelect, sp } from "@/components/admin/filter-bar";
import { FlagReview } from "@/components/admin/flag-review";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/utils";
import { FLAG_STATUSES } from "@/models/SuspicionFlag";
import { listFlags } from "@/services/anticheat.service";

export const metadata: Metadata = { title: "Review flags" };

const DESCRIPTIONS: Record<string, string> = {
  MULTIPLE_ACCOUNTS: "Several accounts answered from the same IP on the same day.",
  RAPID_SUBMISSIONS: "A cluster of accounts on one IP submitted within minutes of each other.",
  SUSPICIOUS_ACTIVITY: "Sessions from an unusual number of distinct IPs in 24 hours.",
};

export default async function FlagsPage({ searchParams }: PageProps<"/admin/flags">) {
  await requireAdmin("flags:manage");
  const params = await searchParams;
  const status = FLAG_STATUSES.find((s) => s === sp(params.status)) ?? (sp(params.status) === "all" ? undefined : "OPEN");
  const page = Math.max(1, Number(sp(params.page) ?? 1) || 1);
  const { items, total } = await listFlags({ status, page, pageSize: 25 });

  return (
    <>
      <PageHeader title="Review flags" description="Anti-cheat heuristics raised by the daily job." />
      <Alert tone="info">Flags are signals, not verdicts. Nothing is banned or rescored automatically — an admin decides.</Alert>
      <FilterBar action="/admin/flags">
        <FilterSelect name="status" label="Status" value={status ?? "all"} options={[{ value: "OPEN", label: "Open" }, { value: "CONFIRMED", label: "Confirmed" }, { value: "DISMISSED", label: "Dismissed" }, { value: "all", label: "All" }]} />
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState icon={<Flag />} title="Nothing to review" description="No flags match this filter." />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr><TH>User</TH><TH>Signal</TH><TH>Day</TH><TH className="hidden md:table-cell">Details</TH><TH>Status</TH><TH className="hidden lg:table-cell">Raised</TH><TH /></tr>
            </THead>
            <TBody>
              {items.map((f) => (
                <TR key={f.id}>
                  <TD><Link href={`/admin/users/${f.userId}`} className="font-medium hover:underline">{f.userName}</Link><p className="text-xs text-muted-foreground">{f.userEmail}</p></TD>
                  <TD><Badge tone="warning">{f.type}</Badge><p className="mt-1 max-w-xs text-xs text-muted-foreground">{DESCRIPTIONS[f.type]}</p></TD>
                  <TD className="tabular-nums">{f.dayNumber ?? "—"}</TD>
                  <TD className="hidden md:table-cell"><code className="text-[11px] text-muted-foreground">{JSON.stringify(f.details)}</code></TD>
                  <TD><Badge tone={f.status === "OPEN" ? "warning" : f.status === "CONFIRMED" ? "danger" : "neutral"}>{f.status}</Badge>{f.reviewNote && <p className="mt-1 text-xs text-muted-foreground">{f.reviewNote}</p>}</TD>
                  <TD className="hidden text-xs lg:table-cell">{formatDateTime(f.createdAt)}</TD>
                  <TD>{f.status === "OPEN" && <FlagReview id={f.id} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={25} total={total} basePath="/admin/flags" searchParams={{ status: status ?? "all" }} />
        </Card>
      )}
    </>
  );
}
