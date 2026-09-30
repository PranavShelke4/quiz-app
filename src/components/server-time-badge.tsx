"use client";

import { Clock } from "lucide-react";
import { useSynchronizedServerTime } from "@/lib/time/server-time";

export function ServerTimeBadge({
  initialServerTime,
  timezone = "Asia/Kolkata",
  className = "",
}: {
  initialServerTime?: string;
  timezone?: string;
  className?: string;
}) {
  const { serverTime } = useSynchronizedServerTime(initialServerTime);

  const formattedTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(serverTime);

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground ${className}`}
      title={`Synchronized with official server time (${timezone})`}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      <Clock className="size-3" aria-hidden />
      <span className="tabular-nums">Server: {formattedTime}</span>
    </div>
  );
}
