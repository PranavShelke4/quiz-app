import { Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalendarDay =
  | { dayNumber: number; state: "ANSWERED" | "MISSED" | "OPEN" | "UPCOMING" }
  | { dayNumber: number; state: "CORRECT" | "WRONG" | "MISSED" };

const LABEL: Record<string, string> = {
  ANSWERED: "answered",
  MISSED: "missed",
  OPEN: "open today",
  UPCOMING: "upcoming",
  CORRECT: "correct",
  WRONG: "wrong",
};

/**
 * 30-day tracker. Before reveal it only shows participation (answered / missed /
 * upcoming) using neutral colours — never green/red. After reveal it can show
 * correctness. Every state has an icon + text label (no colour-only meaning).
 */
export function ProgressCalendar({ days, revealed = false, linkBase }: { days: CalendarDay[]; revealed?: boolean; linkBase?: string }) {
  return (
    <div>
      <ol className="grid grid-cols-6 gap-1.5 sm:grid-cols-10" aria-label="Daily progress">
        {days.map((d) => {
          const content = (
            <>
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{String(d.dayNumber).padStart(2, "0")}</span>
              <span aria-hidden className="flex h-5 items-center justify-center">
                {d.state === "ANSWERED" && <Check className="size-4" />}
                {d.state === "CORRECT" && <Check className="size-4" />}
                {d.state === "WRONG" && <X className="size-4" />}
                {d.state === "MISSED" && <Minus className="size-4" />}
                {d.state === "OPEN" && <span className="size-2 rounded-full bg-primary" />}
                {d.state === "UPCOMING" && <span className="text-xs text-muted-foreground">?</span>}
              </span>
              <span className="sr-only">
                Day {d.dayNumber}: {LABEL[d.state]}
              </span>
            </>
          );
          const cls = cn(
            "flex aspect-square flex-col items-center justify-center rounded-lg border text-center",
            d.state === "ANSWERED" && "border-primary/30 bg-primary-soft text-primary-soft-foreground",
            d.state === "OPEN" && "border-primary border-dashed",
            d.state === "MISSED" && "bg-muted text-muted-foreground",
            d.state === "UPCOMING" && "border-dashed bg-card",
            revealed && d.state === "CORRECT" && "border-success/30 bg-success-soft text-success",
            revealed && d.state === "WRONG" && "border-danger/30 bg-danger-soft text-danger",
          );
          return (
            <li key={d.dayNumber}>
              {linkBase ? (
                <a href={`${linkBase}/${d.dayNumber}`} className={cn(cls, "hover:ring-2 hover:ring-ring/40")}>
                  {content}
                </a>
              ) : (
                <div className={cls}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {revealed ? (
          <>
            <li className="flex items-center gap-1"><Check className="size-3.5" aria-hidden /> Correct</li>
            <li className="flex items-center gap-1"><X className="size-3.5" aria-hidden /> Wrong</li>
            <li className="flex items-center gap-1"><Minus className="size-3.5" aria-hidden /> Missed</li>
          </>
        ) : (
          <>
            <li className="flex items-center gap-1"><Check className="size-3.5" aria-hidden /> Answered</li>
            <li className="flex items-center gap-1"><Minus className="size-3.5" aria-hidden /> Missed</li>
            <li className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" aria-hidden /> Today</li>
            <li className="flex items-center gap-1">? Upcoming</li>
          </>
        )}
      </ul>
    </div>
  );
}
