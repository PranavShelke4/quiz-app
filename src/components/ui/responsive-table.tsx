"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * On phones (< md) a "stack" table shows each row as a card: every cell gets its column
 * header as a label (see `.rtable` in globals.css). Labels are copied from <thead> here,
 * so callers don't have to repeat them; rows added later (client tables) are labelled too.
 */
export function ResponsiveTable({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const label = () => {
      const heads = [...table.querySelectorAll(":scope > thead > tr:first-child > th")];
      const names: string[] = [];
      for (const th of heads) for (let i = 0; i < ((th as HTMLTableCellElement).colSpan || 1); i++) names.push((th.textContent ?? "").trim());
      for (const tr of table.querySelectorAll(":scope > tbody > tr")) {
        let col = 0;
        for (const td of (tr as HTMLTableRowElement).cells) {
          if (!td.hasAttribute("data-label")) td.setAttribute("data-label", td.colSpan > 1 ? "" : (names[col] ?? ""));
          col += td.colSpan || 1;
        }
      }
    };
    label();
    const obs = new MutationObserver(label);
    obs.observe(table, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return <table ref={ref} className={cn("rtable w-full caption-bottom text-sm", className)} {...props} />;
}
