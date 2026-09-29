"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/**
 * Display-only countdown. The target instant comes from the server; the
 * server/browser clock skew is measured once from `serverTime`, so a wrong
 * device clock doesn't mislead the user. No business logic depends on this.
 */
export function Countdown({
  target,
  serverTime,
  compact,
  onDoneLabel = "now",
}: {
  target: string;
  serverTime: string;
  compact?: boolean;
  onDoneLabel?: string;
}) {
  const [skew] = useState(() => Date.parse(serverTime) - Date.now());
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now() + skew);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [skew]);

  const remaining = Date.parse(target) - (now ?? Date.parse(serverTime));
  if (remaining <= 0) return <span>{onDoneLabel}</span>;
  const { d, h, m, s } = parts(remaining);
  const pad = (n: number) => String(n).padStart(2, "0");

  if (compact) {
    return (
      <time dateTime={target} className="tabular-nums" suppressHydrationWarning>
        {d > 0 ? `${d}d ${h}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`}
      </time>
    );
  }
  const units = d > 0 ? [[d, "days"], [h, "hours"], [m, "min"]] : [[h, "hours"], [m, "min"], [s, "sec"]];
  return (
    <time dateTime={target} className="flex gap-3" suppressHydrationWarning aria-live="off">
      {units.map(([v, label]) => (
        <span key={label} className="flex min-w-14 flex-col items-center rounded-lg border bg-card px-3 py-2">
          <span className="text-2xl font-semibold tabular-nums">{pad(v as number)}</span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        </span>
      ))}
    </time>
  );
}
