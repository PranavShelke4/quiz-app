"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApiClientError, api } from "@/lib/api/client";

/** Calls an admin API, toasts the outcome, and refreshes server data. */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function run<T>(key: string, path: string, init: { method?: string; body?: unknown }, success?: string): Promise<T | null> {
    setPending(key);
    try {
      const result = await api<T>(path, init);
      if (success) toast.success(success);
      router.refresh();
      return result;
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Something went wrong.");
      if (e instanceof ApiClientError) throw e;
      return null;
    } finally {
      setPending(null);
    }
  }

  /** Like run() but swallows the error after toasting (for fire-and-forget buttons). */
  async function fire<T>(key: string, path: string, init: { method?: string; body?: unknown }, success?: string) {
    try {
      return await run<T>(key, path, init, success);
    } catch {
      return null;
    }
  }

  return { pending, run, fire };
}
