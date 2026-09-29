export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

type HeaderSource = { get(name: string): string | null };

/**
 * Client IP. X-Forwarded-For is only trusted when TRUST_PROXY=true (i.e. the app
 * sits behind a proxy that overwrites it, like Vercel or a configured nginx).
 * On Vercel, `x-real-ip` is set by the platform.
 */
export function getClientIp(headers: HeaderSource): string | null {
  const trustProxy = process.env.TRUST_PROXY === "true" || process.env.VERCEL === "1";
  if (trustProxy) {
    const xff = headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim().slice(0, 64);
    const real = headers.get("x-real-ip");
    if (real) return real.trim().slice(0, 64);
  }
  return headers.get("x-real-ip")?.trim().slice(0, 64) ?? null;
}

export function getRequestMeta(headers: HeaderSource): RequestMeta {
  return {
    ip: getClientIp(headers),
    userAgent: headers.get("user-agent")?.slice(0, 400) ?? null,
    requestId: headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}
