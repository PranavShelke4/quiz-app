"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * Accessible modal built on the native <dialog> element (focus trap, Esc to
 * close and inert background come from the platform).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  side,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Render as a right-hand drawer instead of a centred modal. */
  side?: "right";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-card p-0 text-card-foreground shadow-xl",
        side === "right" && "my-0 mr-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl rounded-none sm:rounded-l-xl",
        className,
      )}
    >
      {open && (
        <div className={cn("flex flex-col", side === "right" && "h-full")}>
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div className="space-y-1">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descId} className="text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          </div>
          {children && <div className={cn("p-5", side === "right" && "flex-1 overflow-y-auto")}>{children}</div>}
          {footer && <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/**
 * Confirmation for dangerous operations. Pass `confirmText` to require the
 * admin to type an exact value (e.g. the competition name).
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  loadingLabel,
  tone = "danger",
  confirmText,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  loadingLabel?: string;
  tone?: "danger" | "primary";
  confirmText?: string;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const blocked = confirmText !== undefined && typed.trim() !== confirmText;

  const close = () => {
    if (busy) return;
    setTyped("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={blocked}
            loading={busy}
            loadingText={loadingLabel}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setTyped("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {confirmText !== undefined && (
        <div className="mt-2 space-y-2">
          <label htmlFor={inputId} className="text-sm">
            Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{confirmText}</span> to confirm.
          </label>
          <Input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
    </Dialog>
  );
}
