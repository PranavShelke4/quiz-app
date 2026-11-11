import type { Metadata } from "next";
import { CalendarCheck2, ShieldCheck, Trophy } from "lucide-react";
import { Logo } from "@/components/site-header";

export const metadata: Metadata = { robots: { index: false, follow: true } };

const POINTS = [
  { icon: CalendarCheck2, text: "A new question every day" },
  { icon: ShieldCheck, text: "Timed, fair and the same rules for everyone" },
  { icon: Trophy, text: "Scores revealed together at the finish" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel: desktop only. On phones the form comes first. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-navy p-10 text-white lg:flex">
        <div className="brand-stripe absolute inset-x-0 top-0 h-1.5" aria-hidden />
        <Logo tone="inverse" />
        <div className="space-y-6">
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-balance">
            Test what you know. <span className="text-brand-orange">Every day.</span>
          </h2>
          <ul className="space-y-3 text-white/85">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <p.icon className="size-4 text-brand-orange" aria-hidden />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/55">For ICICI Bank colleagues only.</p>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="lg:hidden">
          <div className="brand-stripe h-1" aria-hidden />
          <div className="flex h-16 items-center px-4 sm:px-6">
            <Logo />
          </div>
        </header>
        <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
