"use client";

import { Copy, KeyRound, LogOut, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";

export function UserActions({
  id,
  name,
  isActive,
  role,
  canManageRoles,
  isSelf,
}: {
  id: string;
  name: string;
  isActive: boolean;
  role: string;
  canManageRoles: boolean;
  isSelf: boolean;
}) {
  const { fire, pending } = useAction();
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"disable" | "logout" | "role" | null>(null);
  const [reason, setReason] = useState("");
  const [newRole, setNewRole] = useState(role);
  const post = <T,>(body: Record<string, unknown>, msg?: string) => fire<T>(String(body.action), `/api/admin/users/${id}`, { body }, msg);

  return (
    <div className="flex flex-wrap gap-2">
      {!isSelf &&
        (isActive ? (
          <Button variant="danger" size="sm" onClick={() => setDialog("disable")}>
            <UserX /> Disable account
          </Button>
        ) : (
          <Button size="sm" loading={pending === "enable"} onClick={() => post({ action: "enable" }, "Account enabled.")}>
            <UserCheck /> Enable account
          </Button>
        ))}
      <Button variant="outline" size="sm" onClick={() => setDialog("logout")}>
        <LogOut /> Force logout
      </Button>
      <Button
        variant="outline"
        size="sm"
        loading={pending === "reset-password"}
        onClick={async () => {
          const res = await post<{ resetUrl: string }>({ action: "reset-password" });
          if (res) setResetUrl(res.resetUrl);
        }}
      >
        <KeyRound /> Create reset link
      </Button>
      {canManageRoles && !isSelf && (
        <Button variant="outline" size="sm" onClick={() => setDialog("role")}>
          <ShieldCheck /> Change role
        </Button>
      )}

      <Dialog
        open={resetUrl !== null}
        onClose={() => setResetUrl(null)}
        title="Password reset link"
        description={`Send this link to ${name}. It works once and expires in 24 hours.`}
        footer={
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(resetUrl ?? "");
              toast.success("Link copied.");
            }}
          >
            <Copy /> Copy link
          </Button>
        }
      >
        <Input readOnly value={resetUrl ?? ""} aria-label="Reset link" onFocus={(e) => e.currentTarget.select()} />
      </Dialog>
      <ConfirmDialog
        open={dialog === "disable"}
        onClose={() => setDialog(null)}
        title={`Disable ${name}?`}
        description="They'll be signed out everywhere and can't sign in until re-enabled. Their competition records are kept."
        confirmLabel="Disable account"
        loadingLabel="Disabling…"
        onConfirm={async () => {
          if (reason.trim().length < 3) return;
          await post({ action: "disable", reason }, "Account disabled.");
          setDialog(null);
          setReason("");
        }}
      >
        <Field id="disable-reason" label="Reason (required, kept in the audit log)">
          <Textarea id="disable-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "logout"}
        onClose={() => setDialog(null)}
        title="Sign this user out everywhere?"
        confirmLabel="Force logout"
        loadingLabel="Signing out…"
        onConfirm={async () => {
          await post({ action: "force-logout" }, "All sessions revoked.");
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog === "role"}
        onClose={() => setDialog(null)}
        tone="primary"
        title="Change role"
        description="Changing a role signs the user out of all sessions."
        confirmLabel="Save role"
        loadingLabel="Saving…"
        onConfirm={async () => {
          await post({ action: "change-role", role: newRole }, "Role updated.");
          setDialog(null);
        }}
      >
        <Field id="role" label="Role">
          <Select id="role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
            <option value="SUPER_ADMIN">Super admin</option>
          </Select>
        </Field>
      </ConfirmDialog>
    </div>
  );
}
