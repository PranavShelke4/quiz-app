"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ApiClientError, api } from "@/lib/api/client";

interface CompetitionDeleteButtonProps {
  id: string;
  name: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "link";
  size?: "sm" | "md" | "lg" | "icon";
  redirectTo?: string;
  requireConfirmName?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function CompetitionDeleteButton({
  id,
  name,
  variant = "danger",
  size = "sm",
  redirectTo,
  requireConfirmName = false,
  className,
  children,
}: CompetitionDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      await api(`/api/admin/competitions/${id}`, {
        method: "DELETE",
        body: { confirmName: name },
      });
      toast.success(`Competition "${name}" deleted.`);
      setOpen(false);
      if (redirectTo) {
        router.push(redirectTo);
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Failed to delete competition.";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={`Delete competition ${name}`}
        aria-label={`Delete competition ${name}`}
      >
        <Trash2 className={size === "icon" ? "size-4" : undefined} />
        {size !== "icon" && (children ?? <span>Delete</span>)}
      </Button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete competition?"
        description={
          <span>
            Are you sure you want to permanently delete <strong>{name}</strong>? All associated questions, answers, and participant records will be permanently removed. This action cannot be undone.
          </span>
        }
        confirmText={requireConfirmName ? name : undefined}
        confirmLabel="Delete competition"
        loadingLabel="Deleting…"
        onConfirm={handleDelete}
      />
    </>
  );
}
