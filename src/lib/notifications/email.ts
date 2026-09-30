import { appUrl, env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Provider-agnostic email delivery. Business logic calls the `send*` helpers;
 * transports are selected by EMAIL_PROVIDER. Add a provider by implementing
 * `EmailTransport` and registering it in `getTransport()`.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage & { from: string }): Promise<void>;
}

const consoleTransport: EmailTransport = {
  name: "console",
  async send(message) {
    // Dev only: prints the email (including links) to server logs.
    console.log(
      `\n──── email (console provider) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n─────────────────────────────────\n`,
    );
  },
};

const resendTransport: EmailTransport = {
  name: "resend",
  async send(message) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env().EMAIL_PROVIDER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
  },
};

type TransportGlobal = typeof globalThis & { __emailTransportOverride?: EmailTransport };

/** Tests can capture outgoing mail with setEmailTransportForTesting(). */
export function setEmailTransportForTesting(transport: EmailTransport | null) {
  (globalThis as TransportGlobal).__emailTransportOverride = transport ?? undefined;
}

function getTransport(): EmailTransport {
  const override = (globalThis as TransportGlobal).__emailTransportOverride;
  if (override) return override;
  return env().EMAIL_PROVIDER === "resend" ? resendTransport : consoleTransport;
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  try {
    await getTransport().send({ ...message, from: env().EMAIL_FROM });
    return true;
  } catch (error) {
    // Email failures must never break the calling business operation.
    logger.error("email.send_failed", { subject: message.subject, error });
    return false;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, paragraphs: string[], cta?: { label: string; url: string }) {
  const text = [title, "", ...paragraphs, ...(cta ? ["", `${cta.label}: ${cta.url}`] : [])].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px"><tr><td style="padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#374151">${escapeHtml(p)}</p>`).join("")}
${cta ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="background:#4338ca;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p><p style="font-size:12px;color:#6b7280;word-break:break-all">${escapeHtml(cta.url)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const url = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  const body = layout(
    "Reset your password",
    [`Hi ${name},`, "We received a request to reset your password. This link expires in 1 hour.", "If you didn't request this, you can ignore this email."],
    { label: "Reset password", url },
  );
  return sendEmail({ to, subject: "Reset your password", ...body });
}

export async function sendDailyReminder(to: string, name: string, competitionName: string, dayNumber: number) {
  const body = layout(`Day ${dayNumber} is live`, [`Hi ${name},`, `Today's ${competitionName} question is waiting for you.`], {
    label: "Answer today's question",
    url: appUrl("/quiz"),
  });
  return sendEmail({ to, subject: `Today's quiz is waiting — Day ${dayNumber}`, ...body });
}

export async function sendDeadlineReminder(to: string, name: string, hoursLeft: number) {
  const body = layout("Time is running out", [`Hi ${name},`, `Only ${hoursLeft} hours left to answer today's question.`], {
    label: "Answer now",
    url: appUrl("/quiz"),
  });
  return sendEmail({ to, subject: `Only ${hoursLeft} hours left to answer today's question`, ...body });
}

export async function sendLeaderboardRevealEmail(to: string, name: string, competitionName: string) {
  const body = layout("Final results are in", [`Hi ${name},`, `The final leaderboard for ${competitionName} is now available.`], {
    label: "View results",
    url: appUrl("/leaderboard"),
  });
  return sendEmail({ to, subject: `${competitionName}: final leaderboard revealed`, ...body });
}
