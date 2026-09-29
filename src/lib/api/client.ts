"use client";

import type { ApiResponse } from "@/lib/api/response";

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Field errors from a VALIDATION_ERROR, keyed by field name. */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details as { fields?: Record<string, string[]> } | undefined;
    return d?.fields ?? {};
  }
}

/** Typed fetch for our JSON API. Same-origin cookies only; never stores auth client-side. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Network error. Check your connection and try again.", 0);
  }
  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError("INTERNAL_ERROR", "Something went wrong. Please try again.", res.status);
  }
  if (!json.success) throw new ApiClientError(json.error.code, json.error.message, res.status, json.error.details);
  return json.data;
}
