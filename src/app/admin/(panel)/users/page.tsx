import type { Metadata } from "next";
import Link from "next/link";
import { Download, Users } from "lucide-react";
import { FilterBar, FilterDate, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { DownloadButton } from "@/components/ui/button";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { usersQuerySchema } from "@/lib/validation/admin";
import { toPlainObject } from "@/lib/validation/common";
import { formatDate, formatDateTime } from "@/lib/utils";
import { listUsers } from "@/services/user.service";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  await requireAdmin("users:manage");
  const raw = toPlainObject(await searchParams);
  const parsed = usersQuerySchema.safeParse(raw);
  const q = parsed.success ? parsed.data : usersQuerySchema.parse({});
  const { items, total } = await listUsers(q);
  const qs = new URLSearchParams(Object.entries(raw).filter(([k, v]) => v && k !== "page")).toString();
  const keep = { search: q.search, status: q.status, role: q.role, verified: q.verified, from: q.from, to: q.to, sort: q.sort, dir: q.dir };

  return (
    <>
      <PageHeader
        title="Users"
        description={`${total} user${total === 1 ? "" : "s"}`}
        actions={<DownloadButton href={`/api/admin/users/export?${qs}`}><Download /> Export CSV</DownloadButton>}
      />
      <FilterBar action="/admin/users" resetHref="/admin/users">
        <SearchInput defaultValue={q.search} placeholder="Search name or email" />
        <FilterSelect name="status" label="Status" value={q.status} options={[{ value: "", label: "Any" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} />
        <FilterSelect name="verified" label="Email" value={q.verified} options={[{ value: "", label: "Any" }, { value: "yes", label: "Verified" }, { value: "no", label: "Unverified" }]} />
        <FilterSelect name="role" label="Role" value={q.role} options={[{ value: "", label: "Any" }, { value: "USER", label: "User" }, { value: "ADMIN", label: "Admin" }, { value: "SUPER_ADMIN", label: "Super admin" }]} />
        <FilterDate name="from" label="Registered from" value={q.from} />
        <FilterDate name="to" label="to" value={q.to} />
        <FilterSelect name="sort" label="Sort" value={q.sort} options={[{ value: "createdAt", label: "Registered" }, { value: "lastLoginAt", label: "Last login" }, { value: "name", label: "Name" }, { value: "email", label: "Email" }]} />
        <FilterSelect name="dir" label="Order" value={q.dir} options={[{ value: "desc", label: "Descending" }, { value: "asc", label: "Ascending" }]} />
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState icon={<Users />} title={q.search || q.status || q.role ? "No users match these filters" : "No users have registered yet."} />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Role</TH>
                <TH className="hidden lg:table-cell">Registered</TH>
                <TH className="hidden lg:table-cell">Last login</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3 hover:underline">
                      <Avatar name={u.name} src={u.avatar} />
                      <span>
                        <span className="block font-medium">{u.name}</span>
                        <span className="block text-xs text-muted-foreground">{u.email}</span>
                      </span>
                    </Link>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={u.isActive ? "success" : "danger"}>{u.isActive ? "Active" : "Disabled"}</Badge>
                      {!u.isEmailVerified && <Badge tone="warning">Unverified</Badge>}
                    </div>
                  </TD>
                  <TD className="hidden text-xs md:table-cell">{u.role}</TD>
                  <TD className="hidden text-sm lg:table-cell">{formatDate(u.createdAt)}</TD>
                  <TD className="hidden text-sm lg:table-cell">{formatDateTime(u.lastLoginAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={q.page} pageSize={q.pageSize} total={total} basePath="/admin/users" searchParams={keep} />
        </Card>
      )}
    </>
  );
}
