import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { FilterBar, FilterDate, FilterSelect, sp } from "@/components/admin/filter-bar";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/utils";
import { AUDIT_ACTIONS } from "@/models/AuditLog";
import { listAuditLogs } from "@/services/audit.service";

export const metadata: Metadata = { title: "Audit logs" };

export default async function AuditLogsPage({ searchParams }: PageProps<"/admin/audit-logs">) {
  await requireAdmin("audit:view");
  const params = await searchParams;
  const action = AUDIT_ACTIONS.find((a) => a === sp(params.action));
  const from = sp(params.from);
  const to = sp(params.to);
  const page = Math.max(1, Number(sp(params.page) ?? 1) || 1);
  const { items, total } = await listAuditLogs({ action, from, to, page, pageSize: 30 });

  return (
    <>
      <PageHeader title="Audit logs" description="Append-only record of sensitive admin operations. Entries can't be edited or deleted." />
      <FilterBar action="/admin/audit-logs" resetHref="/admin/audit-logs">
        <FilterSelect name="action" label="Action" value={action} options={[{ value: "", label: "All actions" }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: a }))]} />
        <FilterDate name="from" label="From" value={from} />
        <FilterDate name="to" label="To" value={to} />
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="No audit entries" />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr><TH>When</TH><TH>Action</TH><TH>Admin</TH><TH>Target</TH><TH className="hidden lg:table-cell">Details</TH><TH className="hidden md:table-cell">IP</TH></tr>
            </THead>
            <TBody>
              {items.map((l) => (
                <TR key={l.id}>
                  <TD className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt)}</TD>
                  <TD><Badge tone={l.action.includes("DELETE") || l.action.includes("DISABLED") || l.action === "ANSWER_CORRECTED" ? "warning" : "neutral"}>{l.action}</Badge></TD>
                  <TD className="text-sm">{l.admin ? <><span className="block">{l.admin.name}</span><span className="text-xs text-muted-foreground">{l.admin.email}</span></> : <span className="text-muted-foreground">System</span>}</TD>
                  <TD className="text-xs"><span className="block">{l.targetType ?? "—"}</span><span className="font-mono text-muted-foreground">{l.targetId}</span></TD>
                  <TD className="hidden max-w-md lg:table-cell"><code className="line-clamp-3 break-all text-[11px] text-muted-foreground">{JSON.stringify(l.metadata)}</code></TD>
                  <TD className="hidden font-mono text-xs md:table-cell">{l.ipAddress ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={30} total={total} basePath="/admin/audit-logs" searchParams={{ action, from, to }} />
        </Card>
      )}
    </>
  );
}
