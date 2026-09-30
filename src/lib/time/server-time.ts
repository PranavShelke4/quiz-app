"use client";

import { useEffect, useState } from "react";

/**
 * Calculates clock skew: serverTime - deviceTime.
 * Adding this skew to Date.now() yields the exact server time instant.
 */
export function calculateSkew(serverTime: string): number {
  const parsed = Date.parse(serverTime);
  return Number.isNaN(parsed) ? 0 : parsed - Date.now();
}

/**
 * Hook that maintains an authoritative server-synchronized clock.
 * Ticks every second and re-syncs periodically with /api/time.
 */
export function useSynchronizedServerTime(initialServerTime?: string) {
  const [skew, setSkew] = useState<number>(() =>
    initialServerTime ? calculateSkew(initialServerTime) : 0,
  );
  const [currentServerTime, setCurrentServerTime] = useState<Date>(() =>
    new Date(Date.now() + (initialServerTime ? calculateSkew(initialServerTime) : 0)),
  );

  useEffect(() => {
    // Background sync with /api/time to eliminate local clock drift
    let active = true;
    async function sync() {
      try {
        const res = await fetch("/api/time", { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (active && json.data?.serverTime) {
            setSkew(calculateSkew(json.data.serverTime));
          }
        }
      } catch {
        /* Ignore offline sync errors */
      }
    }

    if (!initialServerTime) {
      void sync();
    }

    const syncInterval = setInterval(sync, 60_000); // sync every minute
    return () => {
      active = false;
      clearInterval(syncInterval);
    };
  }, [initialServerTime]);

  useEffect(() => {
    const tick = () => {
      setCurrentServerTime(new Date(Date.now() + skew));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [skew]);

  return {
    serverTime: currentServerTime,
    skew,
    nowMs: currentServerTime.getTime(),
  };
}
