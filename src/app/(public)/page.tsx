import type { Metadata } from "next";
import { CalendarDays, CheckCircle2, EyeOff, Lock, Target, Trophy } from "lucide-react";
import { Countdown } from "@/components/countdown";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardContent, Progress } from "@/components/ui/primitives";
import { getAuth } from "@/lib/auth/dal";
import { formatDate } from "@/lib/utils";
import { getCurrentCompetition, toPublicCompetition, type PublicCompetitionDTO } from "@/services/competition.service";

export const metadata: Metadata = {
  title: { absolute: "Daily Quiz — One question a day. One month. One champion." },
  description: "Join the 30-day Daily Quiz competition. One question every day, four options, one answer. Scores stay hidden until the final reveal.",
  alternates: { canonical: "/" },
};

async function loadCompetition(): Promise<PublicCompetitionDTO | null> {
  try {
    const comp = await getCurrentCompetition();
    return comp ? toPublicCompetition(comp) : null;
  } catch {
    // The marketing page must render even if the database is unreachable.
    return null;
  }
}

const STEPS = [
  { icon: CalendarDays, title: "A new question every day", body: "Each day at 12:00 AM a fresh question unlocks. It stays open until 11:59 PM." },
  { icon: Target, title: "Pick one of four options", body: "Read carefully — you get exactly one submission. Answers can't be changed." },
  { icon: EyeOff, title: "Results stay hidden", body: "Nobody sees right or wrong until the competition ends. No spoilers, no leaks." },
  { icon: Trophy, title: "The big reveal", body: "When the final day closes, the leaderboard and every answer are revealed." },
];

function StatusPanel({ c }: { c: PublicCompetitionDTO | null }) {
  if (!c) {
    return (
      <Card className="p-6">
        <p className="font-medium">No competition is scheduled right now.</p>
        <p className="mt-1 text-sm text-muted-foreground">Create an account and we&apos;ll be ready when the next one opens.</p>
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{c.name}</p>
        {c.phase === "ACTIVE" && <Badge tone="success">Live</Badge>}
        {c.phase === "NOT_STARTED" && <Badge tone="primary">Upcoming</Badge>}
        {c.phase === "ENDED" && <Badge>Completed</Badge>}
      </div>
      {c.phase === "NOT_STARTED" && (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-muted-foreground">Competition starts in</p>
          <Countdown target={c.startsAt} serverTime={c.serverTime} />
          <p className="text-sm text-muted-foreground">
            {formatDate(c.startsAt, c.timezone)} · {c.durationDays} days · {c.timezone}
          </p>
        </div>
      )}
      {c.phase === "ACTIVE" && (
        <div className="mt-5 space-y-4">
          <p className="text-4xl font-semibold tracking-tight">
            Day {c.currentDay} <span className="text-muted-foreground">of {c.durationDays}</span>
          </p>
          <Progress value={((c.currentDay ?? 0) / c.durationDays) * 100} label="Competition progress" />
          <div className="text-sm text-muted-foreground">
            Today&apos;s question closes in{" "}
            <span className="font-medium text-foreground">
              <Countdown compact target={c.todayClosesAt!} serverTime={c.serverTime} />
            </span>
          </div>
        </div>
      )}
      {c.phase === "ENDED" && (
        <div className="mt-5 space-y-4">
          <p className="text-2xl font-semibold">Competition completed</p>
          <ButtonLink href="/leaderboard">
            <Trophy /> View Leaderboard
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}

export default async function LandingPage() {
  const [competition, auth] = await Promise.all([loadCompetition(), getAuth()]);
  const cta = auth ? { href: "/dashboard", label: "Go to your dashboard" } : { href: "/signup", label: "Join the Competition" };

  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div className="space-y-6">
          <Badge tone="primary">{competition ? `${competition.durationDays}-day challenge` : "Daily challenge"}</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">One question a day. One month. One champion.</h1>
          <p className="max-w-xl text-lg text-muted-foreground text-pretty">
            {competition?.description ||
              "Show up every day, answer a single question, and climb a leaderboard that stays secret until the very end."}
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={cta.href} size="lg">
              {cta.label}
            </ButtonLink>
            {!auth && (
              <ButtonLink href="/login" size="lg" variant="outline">
                Sign in
              </ButtonLink>
            )}
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {["One submission per day", "Four options", "Results revealed at the end"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-primary" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </div>
        <StatusPanel c={competition} />
      </section>

      <section aria-labelledby="how" className="border-y bg-card/60">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how" className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <Card className="h-full p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                      <s.icon className="size-4" aria-hidden />
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="rules" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-3">
            <h2 id="rules" className="text-2xl font-semibold tracking-tight">The rules, briefly</h2>
            <p className="text-muted-foreground">Fair for everyone, enforced on the server — not in your browser.</p>
            <ButtonLink href="/rules" variant="outline">
              Read the full rules
            </ButtonLink>
          </div>
          <Card>
            <CardContent className="pt-5 sm:pt-6">
              <ul className="space-y-3 text-sm">
                {(competition?.rules ?? []).slice(0, 5).map((r) => (
                  <li key={r} className="flex gap-3">
                    <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>{r}</span>
                  </li>
                ))}
                {!competition && <li className="text-muted-foreground">Rules are published with each competition.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
