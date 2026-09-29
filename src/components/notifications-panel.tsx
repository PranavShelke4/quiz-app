"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { cn, formatDateTime } from "@/lib/utils";

interface Item {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export function NotificationsPanel() {
  const [data, setData] = useState<{ unread: number; items: Item[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api<{ unread: number; items: Item[] }>("/api/notifications", { signal: ctrl.signal })
      .then(setData)
      .catch(() => !ctrl.signal.aborted && setError(true));
    return () => ctrl.abort();
  }, []);

  if (error) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4" aria-hidden /> Notifications
          {!!data?.unread && <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{data.unread}</span>}
        </CardTitle>
        {!!data?.unread && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await api("/api/notifications", { body: {} });
              setData((d) => d && { unread: 0, items: d.items.map((i) => ({ ...i, read: true })) });
            }}
          >
            Mark all read
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <ul className="divide-y">
            {data.items.slice(0, 6).map((n) => (
              <li key={n.id} className={cn("flex gap-3 py-3 text-sm", n.read && "opacity-70")}>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                  <p className="text-muted-foreground">{n.body}</p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={n.createdAt}>
                  {formatDateTime(n.createdAt, undefined, { dateStyle: "short", timeStyle: undefined })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
