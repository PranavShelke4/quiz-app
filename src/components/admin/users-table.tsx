"use client";

import { Eye, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/admin/use-action";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Alert, Avatar, Badge, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ApiClientError, api } from "@/lib/api/client";
import { trackOptions } from "@/lib/teams";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { AdminUserDTO } from "@/services/user.service";

export function UsersTable({ users, currentUserId, isSuper }: { users: AdminUserDTO[]; currentUserId: string; isSuper: boolean }) {
  const { fire } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminUserDTO | null>(null);
  const [deleting, setDeleting] = useState<AdminUserDTO | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Only participant accounts can be deleted (admins must be demoted first), never yourself.
  const canDelete = (u: AdminUserDTO) => u.role === "USER" && u.id !== currentUserId;
  // Admin accounts can only be edited by a super admin.
  const canEdit = (u: AdminUserDTO) => u.role === "USER" || isSuper;
  const deletable = users.filter(canDelete);
  const selectedIds = deletable.filter((u) => selected.has(u.id)).map((u) => u.id);
  const allSelected = deletable.length > 0 && selectedIds.length === deletable.length;
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
          <span>
            <strong>{selectedIds.length}</strong> selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="danger" size="sm" onClick={() => setBulkOpen(true)}>
              <Trash2 /> Delete {selectedIds.length}
            </Button>
          </div>
        </div>
      )}
      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <Checkbox
                aria-label="Select all deletable users on this page"
                checked={allSelected}
                disabled={!deletable.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(deletable.map((u) => u.id)) : new Set())}
              />
            </TH>
            <TH>User</TH>
            <TH>Status</TH>
            <TH className="hidden md:table-cell">Role</TH>
            <TH className="hidden lg:table-cell">Registered</TH>
            <TH className="hidden lg:table-cell">Last login</TH>
            <TH className="text-right">Actions</TH>
          </tr>
        </THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id} className={selected.has(u.id) ? "bg-primary-soft/40" : undefined}>
              <TD>{canDelete(u) && <Checkbox aria-label={`Select ${u.name}`} checked={selected.has(u.id)} onChange={() => toggle(u.id)} />}</TD>
              <TD>
                <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3 hover:underline">
                  <Avatar name={u.name} src={u.avatar} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                  </span>
                </Link>
              </TD>
              <TD>
                <Badge tone={u.isActive ? "success" : "danger"}>{u.isActive ? "Active" : "Disabled"}</Badge>
              </TD>
              <TD className="hidden text-xs md:table-cell">{u.role}</TD>
              <TD className="hidden text-sm lg:table-cell">{formatDate(u.createdAt)}</TD>
              <TD className="hidden text-sm lg:table-cell">{formatDateTime(u.lastLoginAt)}</TD>
              <TD>
                <div className="flex justify-end gap-0.5">
                  <ButtonLink href={`/admin/users/${u.id}`} variant="ghost" size="icon" aria-label={`View ${u.name}`} title="View">
                    <Eye />
                  </ButtonLink>
                  {canEdit(u) && (
                    <Button variant="ghost" size="icon" aria-label={`Edit ${u.name}`} title="Edit" onClick={() => setEditing(u)}>
                      <Pencil />
                    </Button>
                  )}
                  {canDelete(u) && (
                    <Button variant="ghost" size="icon" aria-label={`Delete ${u.name}`} title="Delete" className="text-danger" onClick={() => setDeleting(u)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Permanently delete ${deleting?.name ?? "user"}?`}
        description="Deletes the account and all of its answers, competition entries and notifications. Leaderboards are recalculated. This cannot be undone."
        confirmLabel="Delete user"
        loadingLabel="Deleting…"
        confirmText={deleting?.email}
        onConfirm={async () => {
          if (!deleting) return;
          const r = await fire(`del-${deleting.id}`, `/api/admin/users/${deleting.id}`, { method: "DELETE", body: { confirmEmail: deleting.email } }, "User deleted.");
          if (r) {
            setSelected((cur) => {
              const next = new Set(cur);
              next.delete(deleting.id);
              return next;
            });
            setDeleting(null);
          }
        }}
      />

      <ConfirmDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`Permanently delete ${selectedIds.length} user${selectedIds.length === 1 ? "" : "s"}?`}
        description="Deletes these accounts and all of their answers, competition entries and notifications. Leaderboards are recalculated. This cannot be undone."
        confirmLabel={`Delete ${selectedIds.length}`}
        loadingLabel="Deleting…"
        confirmText="DELETE"
        onConfirm={async () => {
          const r = await fire<{ deleted: number; skipped: number }>("bulk-del", "/api/admin/users/bulk-delete", { body: { ids: selectedIds, confirm: "DELETE" } });
          if (r) {
            toast.success(`${r.deleted} user${r.deleted === 1 ? "" : "s"} deleted${r.skipped ? ` · ${r.skipped} skipped` : ""}.`);
            setSelected(new Set());
            setBulkOpen(false);
          }
        }}
      />
    </>
  );
}

function EditUserDialog({ user, onClose }: { user: AdminUserDTO; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [team, setTeam] = useState(user.team || "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const teams = trackOptions(user.team);

  async function save() {
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: { name, email, ...(team ? { team } : {}) } });
      toast.success("User updated.");
      router.refresh();
      onClose();
    } catch (e) {
      if (e instanceof ApiClientError) {
        setErrors(e.fieldErrors);
        setFormError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${user.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy} loadingText="Saving…">Save changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field id="u-name" label="Name" error={errors.name}>
          <Input id="u-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="u-email" label="Email" hint="The user signs in with this address." error={errors.email}>
          <Input id="u-email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="u-team" label="Track" error={errors.team}>
          <Select id="u-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            {!team && <option value="" disabled>Select a track</option>}
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
