import { NextResponse } from "next/server";
import { ERROR_DEFINITIONS, type ErrorCode } from "@/lib/errors";

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: { code: ErrorCode; message: string; details?: unknown };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

const NO_STORE = { "Cache-Control": "no-store, max-age=0", Vary: "Cookie" };

export function ok<T>(data: T, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json<ApiSuccess<T>>(
    { success: true, data },
    { status: init.status ?? 200, headers: { ...NO_STORE, ...init.headers } },
  );
}

export function fail(code: ErrorCode, message?: string, details?: unknown, headers?: Record<string, string>) {
  const def = ERROR_DEFINITIONS[code];
  return NextResponse.json<ApiFailure>(
    { success: false, error: { code, message: message ?? def.message, ...(details !== undefined ? { details } : {}) } },
    { status: def.status, headers: { ...NO_STORE, ...headers } },
  );
}
