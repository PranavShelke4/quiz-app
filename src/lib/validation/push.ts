import { z } from "zod";

/**
 * Browsers' push services. The server POSTs to a subscription's endpoint, so endpoints are
 * restricted to these hosts — otherwise a user could make the server call any URL (SSRF).
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

export function isAllowedPushEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export const pushEndpointSchema = z.string().max(2048).refine(isAllowedPushEndpoint, "Unsupported push service");

export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(128) }),
});

export const pushActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("subscribe"), subscription: pushSubscriptionSchema }),
  z.object({ action: z.literal("unsubscribe"), endpoint: pushEndpointSchema }),
  z.object({ action: z.literal("check"), endpoint: pushEndpointSchema }),
]);

export const pushBroadcastSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(240),
  // Same-site path only, e.g. "/quiz".
  url: z
    .string()
    .trim()
    .max(200)
    .regex(/^\/(?!\/)\S*$/, "Use a path on this site, e.g. /quiz")
    .optional()
    .or(z.literal("")),
});
