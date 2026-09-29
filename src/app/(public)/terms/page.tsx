import type { Metadata } from "next";
import { Alert } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms that apply when you take part in Daily Quiz competitions.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-12 text-sm leading-relaxed sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of service</h1>
      <Alert tone="warning" title="Placeholder — requires legal review">
        These terms are a starting template and must be reviewed by qualified counsel before use, especially if prizes are offered.
      </Alert>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Eligibility &amp; accounts</h2>
        <p>One account per person. You are responsible for keeping your credentials secure. [Minimum age and eligible regions — to be completed.]</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. Competition rules</h2>
        <p>Participation is subject to the published competition rules, which form part of these terms.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Fair play</h2>
        <p>We may disqualify entries or suspend accounts involved in cheating, automation, multiple accounts or other abuse, following human review.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Corrections &amp; final results</h2>
        <p>Administrators may correct erroneous questions. Corrections are applied equally to all participants and documented. [Dispute process — to be completed.]</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Prizes</h2>
        <p>[If prizes are offered: prize description, eligibility, tax, claiming process — to be completed.]</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Liability &amp; changes</h2>
        <p>[Limitation of liability, governing law, and how these terms may change — to be completed.]</p>
      </section>
    </article>
  );
}
