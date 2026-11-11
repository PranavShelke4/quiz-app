import type { Metadata } from "next";
import { Download, Users } from "lucide-react";
import { FilterBar, FilterDate, FilterSelect, SearchInput } from "@/components/admin/filter-bar";
import { UsersTable } from "@/components/admin/users-table";
import { DownloadButton } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { usersQuerySchema } from "@/lib/validation/admin";
import { toPlainObject } from "@/lib/validation/common";
import { listUsers } from "@/services/user.service";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const auth = await requireAdmin("users:manage");
  const raw = toPlainObject(await searchParams);
  const parsed = usersQuerySchema.safeParse(raw);
  const q = parsed.success ? parsed.data : usersQuerySchema.parse({});
  const { items, total } = await listUsers(q);
  const qs = new URLSearchParams(Object.entries(raw).filter(([k, v]) => v && k !== "page")).toString();
  const keep = { search: q.search, status: q.status, role: q.role, from: q.from, to: q.to, sort: q.sort, dir: q.dir };

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
          <UsersTable users={items} currentUserId={auth.user.id} isSuper={auth.user.role === "SUPER_ADMIN"} />
          <Pagination page={q.page} pageSize={q.pageSize} total={total} basePath="/admin/users" searchParams={keep} />
        </Card>
      )}
    </>
  );
}
