"use client";

import { useState } from "react";
import { useAction } from "@/components/admin/use-action";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { AdminDayState } from "@/services/makeup.service";

const STYLE: Record<AdminDayState, string> = {
  ANSWERED: "bg-success-soft text-success ring-success/25",
  MISSED: "bg-danger-soft text-danger ring-danger/25",
  LOCKED: "bg-warning-soft text-warning ring-warning/30",
  REOPENED: "bg-primary-soft text-primary-soft-foreground ring-primary/30",
  OPEN: "bg-muted text-foreground ring-border",
  UPCOMING: "bg-muted/40 text-muted-foreground ring-border/60",
};

const LABEL: Record<AdminDayState, string> = {
  ANSWERED: "Answered",
  MISSED: "Missed",
  LOCKED: "Attempt ended (locked / time up)",
  REOPENED: "Re-opened — waiting for the user",
  OPEN: "Open today",
  UPCOMING: "Upcoming",
};

/**
 * Per-day grid for one participant. Clicking a missed/locked day re-opens it for this user only:
 * today is reset; an earlier day becomes a one-time catch-up attempt under the same timer rules.
 */
export function DayAccess({
  userId,
  competitionId,
  days,
  currentDay,
  canReopen,
  timedMode,
}: {
  userId: string;
  competitionId: string;
  days: { dayNumber: number; state: AdminDayState; lockReason: string | null }[];
  currentDay: number | null;
  canReopen: boolean;
  timedMode: boolean;
}) {
  const { fire, pending } = useAction();
  const [target, setTarget] = useState<{ day: number; cancel: boolean } | null>(null);
  const post = (body: Record<string, unknown>, msg: string) => fire(`${body.action}-${body.dayNumber}`, `/api/admin/users/${userId}`, { body }, msg);

  const reopenable = (d: (typeof days)[number]) =>
    canReopen && (d.state === "MISSED" || d.state === "LOCKED") && (d.dayNumber === currentDay || (timedMode && currentDay !== null && d.dayNumber < currentDay));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => {
          const clickable = reopenable(d) || d.state === "REOPENED";
          return (
            <button
              key={d.dayNumber}
              type="button"
              disabled={!clickable || pending !== null}
              title={`Day ${d.dayNumber}: ${LABEL[d.state]}${d.lockReason ? ` (${d.lockReason.replaceAll("_", " ").toLowerCase()})` : ""}${clickable ? " — click to change" : ""}`}
              onClick={() => setTarget({ day: d.dayNumber, cancel: d.state === "REOPENED" })}
              className={cn(
                "size-9 rounded-md text-xs font-medium tabular-nums ring-1 ring-inset transition",
                STYLE[d.state],
                d.dayNumber === currentDay && "outline-2 outline-offset-1 outline-primary",
                clickable ? "cursor-pointer hover:brightness-95 hover:ring-2" : "cursor-default",
              )}
            >
              {d.dayNumber}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Green answered · red missed · amber attempt ended · blue re-opened. Click a missed or amber day to give this user another attempt.
        {!timedMode && " Earlier days can only be re-opened when timed attempts are on."}
      </p>

      <ConfirmDialog
        open={target !== null && !target.cancel}
        onClose={() => setTarget(null)}
        tone="primary"
        title={target ? `Re-open day ${target.day} for this user?` : ""}
        description={
          target?.day === currentDay
            ? "Today's missed record and ended attempt are cleared, so the user can start today's question again before it closes."
            : "The user gets one catch-up attempt at this day on their quiz page, with the same timer and anti-cheat rules. Their score updates when they answer."
        }
        confirmLabel="Re-open day"
        loadingLabel="Re-opening…"
        onConfirm={async () => {
          if (target) await post({ action: "reopen-day", competitionId, dayNumber: target.day }, `Day ${target.day} re-opened.`);
          setTarget(null);
        }}
      />
      <ConfirmDialog
        open={target !== null && target.cancel}
        onClose={() => setTarget(null)}
        tone="danger"
        title={target ? `Withdraw the catch-up for day ${target.day}?` : ""}
        description="The day stays recorded as missed."
        confirmLabel="Withdraw"
        loadingLabel="Withdrawing…"
        onConfirm={async () => {
          if (target) await post({ action: "cancel-reopen", competitionId, dayNumber: target.day }, `Catch-up for day ${target.day} withdrawn.`);
          setTarget(null);
        }}
      />
    </div>
  );
}
