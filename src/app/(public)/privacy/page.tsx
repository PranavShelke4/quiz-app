import type { Metadata } from "next";
import { Alert } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How Daily Quiz collects, uses and protects your personal data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-12 text-sm leading-relaxed sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <Alert tone="warning" title="Placeholder — requires legal review">
        This template describes how the software handles data. Have it reviewed by qualified counsel and adapt it to your jurisdiction before launch.
      </Alert>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Account data: your name, email address and a one-way hash of your password (we never store your password).</li>
          <li>Competition data: the option you submit each day and when you submitted it.</li>
          <li>Security data: IP address and browser user-agent for sign-ins and submissions, used to protect accounts and keep the competition fair.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">How we use it</h2>
        <p>To run the competition, calculate results, send the emails you need (password reset, reminders, results), and detect abuse.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What others can see</h2>
        <p>After results are revealed, your display name, email address, avatar, rank and score appear on the leaderboard, which only signed-in participants can see.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Cookies</h2>
        <p>We use a single essential, HTTP-only session cookie to keep you signed in. We don&apos;t use advertising or tracking cookies.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Retention &amp; your rights</h2>
        <p>[Retention periods, data export/deletion process and contact details — to be completed by the operator.]</p>
      </section>
    </article>
  );
}
