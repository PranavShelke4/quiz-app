import type { Metadata } from "next";
import { ArrowRight, CalendarClock, EyeOff, PlayCircle, ShieldCheck, Shuffle, Timer, Trophy, Users } from "lucide-react";
import { Countdown } from "@/components/countdown";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Progress } from "@/components/ui/primitives";
import { getAuth } from "@/lib/auth/dal";
import { TRACKS } from "@/lib/teams";
import { formatDate } from "@/lib/utils";
import { getCurrentCompetition, toPublicCompetition, type PublicCompetitionDTO } from "@/services/competition.service";

export const metadata: Metadata = {
  title: { absolute: "Daily Quiz: one question a day, one champion" },
  description: "The daily quiz for ICICI Bank colleagues. One question every day, one answer, and a leaderboard revealed at the finish.",
  alternates: { canonical: "/" },
};

async function loadCompetition(): Promise<PublicCompetitionDTO | null> {
  try {
    const comp = await getCurrentCompetition();
    return comp ? toPublicCompetition(comp) : null;
  } catch {
    // The landing page must render even if the database is unreachable.
    return null;
  }
}

/** "09:00" → "9:00 AM" */
function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = ((h! + 11) % 12) + 1;
  return `${hour}:${String(m ?? 0).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
}

function StatusPanel({ c }: { c: PublicCompetitionDTO | null }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card shadow-[0_12px_40px_-16px_rgb(0_74_127/0.35)]">
      <div className="brand-stripe h-1.5" aria-hidden />
      <div className="space-y-5 p-6 sm:p-7">
        {!c ? (
          <>
            <p className="text-lg font-semibold">No competition is scheduled right now.</p>
            <p className="text-sm text-muted-foreground">Create your account now and you&apos;ll be ready when the next one opens.</p>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Current competition</p>
                <p className="text-lg font-semibold leading-snug">{c.name}</p>
              </div>
              {c.phase === "ACTIVE" && <Badge tone="accent">Live now</Badge>}
              {c.phase === "NOT_STARTED" && <Badge tone="primary">Upcoming</Badge>}
              {c.phase === "ENDED" && <Badge>Completed</Badge>}
            </div>

            {c.phase === "NOT_STARTED" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Starts in</p>
                <div className="text-primary">
                  <Countdown target={c.startsAt} serverTime={c.serverTime} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatDate(c.startsAt, c.timezone)}, {c.durationDays} days
                </p>
              </div>
            )}

            {c.phase === "ACTIVE" && (
              <div className="space-y-4">
                <p className="text-4xl font-semibold tracking-tight text-primary">
                  Day {c.currentDay} <span className="text-2xl font-medium text-muted-foreground">of {c.durationDays}</span>
                </p>
                <Progress value={((c.currentDay ?? 0) / c.durationDays) * 100} label="Competition progress" />
                {c.todayClosesAt && (
                  <p className="text-sm text-muted-foreground">
                    Today&apos;s question closes in{" "}
                    <span className="font-semibold text-foreground">
                      <Countdown compact target={c.todayClosesAt} serverTime={c.serverTime} />
                    </span>
                  </p>
                )}
              </div>
            )}

            {c.phase === "ENDED" && (
              <div className="space-y-4">
                <p className="text-2xl font-semibold">The results are in.</p>
                <ButtonLink href="/leaderboard" variant="outline">
                  <Trophy /> View leaderboard
                </ButtonLink>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const [c, auth] = await Promise.all([loadCompetition(), getAuth()]);
  const cta = auth ? { href: "/dashboard", label: "Open dashboard" } : { href: "/signup", label: "Join the quiz" };
  const opens = clockLabel(c?.dailyStartTime ?? "09:00");
  const closes = clockLabel(c?.dailyEndTime ?? "18:00");
  const timed = c?.antiCheat.enabled ?? false;

  const steps = [
    { icon: CalendarClock, title: "A new question every morning", body: `It opens at ${opens} and closes at ${closes}. Miss the window and the day counts as missed.` },
    timed
      ? { icon: PlayCircle, title: "Press Start, then answer", body: `The question appears when you press Start. You get one attempt and ${c!.antiCheat.timeLimitSeconds} seconds.` }
      : { icon: PlayCircle, title: "Answer once", body: "Pick your answer and submit. You get one submission, and it can't be changed." },
    { icon: EyeOff, title: "Results stay hidden", body: "Nobody sees scores or right answers while the competition runs. No spoilers." },
    { icon: Trophy, title: "The reveal", body: "When the last day closes, the leaderboard and every answer are revealed together." },
  ];

  const fairPlay = [
    { icon: Timer, title: "Timed questions", body: "A short clock after Start leaves no time to look answers up.", on: timed },
    { icon: Shuffle, title: "Shuffled options", body: "Everyone sees the options in a different order.", on: timed && c!.antiCheat.shuffleOptions },
    { icon: ShieldCheck, title: "Checked by the server", body: "Timing, scoring and deadlines are decided on the server, not on your phone.", on: true },
  ].filter((f) => f.on);

  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-10 sm:px-6 md:pt-16 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14 lg:pb-20">
        <div className="space-y-6">
          <Badge tone="accent">For ICICI Bank colleagues</Badge>
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-balance text-brand-navy sm:text-5xl lg:text-[3.4rem]">
            One question a day. <span className="text-brand">One champion.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
            {c?.description || "A daily quiz for ICICI Bank colleagues. Answer before it closes and compete for your track."}
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={cta.href} size="lg" className="active:translate-y-px">
              {cta.label} <ArrowRight />
            </ButtonLink>
            {!auth && (
              <ButtonLink href="/login" size="lg" variant="outline">
                Sign in
              </ButtonLink>
            )}
          </div>
        </div>
        <StatusPanel c={c} />
      </section>

      {/* How it works: a sequence, so it reads as a timeline rather than a card grid. */}
      <section aria-labelledby="how" className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
          <h2 id="how" className="text-2xl font-semibold tracking-tight text-brand-navy sm:text-3xl">How it works</h2>
          <ol className="relative mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
            <span className="absolute left-5 top-5 hidden h-0.5 w-[calc(100%-2.5rem)] bg-border md:block" aria-hidden />
            {steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-4 md:flex-col">
                <span
                  className={`relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full ring-4 ring-card ${
                    i === steps.length - 1 ? "bg-accent text-white" : "bg-brand-navy text-white"
                  }`}
                >
                  <s.icon className="size-5" aria-hidden />
                </span>
                <div className="space-y-1">
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Tracks */}
      <section aria-labelledby="tracks" className="bg-brand-navy text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:items-center lg:py-16">
          <div className="space-y-3">
            <h2 id="tracks" className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Users className="size-7 text-brand-orange" aria-hidden /> Compete for your track
            </h2>
            <p className="max-w-md text-white/80">Pick your track when you join. Every answer counts for you and for your team&apos;s standing.</p>
          </div>
          <ul className="flex flex-wrap gap-2.5">
            {TRACKS.map((t) => (
              <li key={t} className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Fair play + rules */}
      <section aria-labelledby="fair" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-4">
            <h2 id="fair" className="text-2xl font-semibold tracking-tight text-brand-navy sm:text-3xl">Fair for everyone</h2>
            <p className="max-w-md text-muted-foreground">Same question window, same rules, and nothing decided by the device in your hand.</p>
            <ButtonLink href="/rules" variant="outline">
              Read the full rules
            </ButtonLink>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {fairPlay.map((f, i) => (
              <li
                key={f.title}
                className={`rounded-xl border p-5 ${i === 0 ? "bg-accent-soft" : "bg-card"} ${i === 0 && fairPlay.length % 2 === 1 ? "sm:col-span-2" : ""}`}
              >
                <f.icon className={`size-6 ${i === 0 ? "text-accent" : "text-primary"}`} aria-hidden />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
