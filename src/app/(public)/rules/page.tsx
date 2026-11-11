import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { DEFAULT_RULE_SECTIONS, getCurrentCompetition, toPublicCompetition } from "@/services/competition.service";

export const metadata: Metadata = {
  title: "Competition rules",
  description: "How the Daily Quiz competition works: one question per day, one submission, hidden results, scoring, tie-breakers and fair play.",
  alternates: { canonical: "/rules" },
};

export default async function RulesPage() {
  const comp = await getCurrentCompetition().catch(() => null);
  const c = comp ? toPublicCompetition(comp) : null;
  const sections = c?.ruleSections ?? DEFAULT_RULE_SECTIONS;

  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Competition rules</h1>
        {c && (
          <p className="text-muted-foreground">
            {c.name} · {c.durationDays} days · {formatDateTime(c.startsAt, c.timezone, { dateStyle: "long", timeStyle: undefined })} to{" "}
            {formatDateTime(new Date(Date.parse(c.endsAt) - 1), c.timezone, { dateStyle: "long", timeStyle: undefined })} ({c.timezone})
          </p>
        )}
      </header>

      {sections.map((section, i) => (
        <Card key={`${i}-${section.title}`}>
          <CardHeader className="space-y-1">
            <CardTitle>{section.title}</CardTitle>
            {section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}
          </CardHeader>
          {section.rules.length > 0 && (
            <CardContent>
              <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                {section.rules.map((r, k) => (
                  <li key={k}>{r}</li>
                ))}
              </ol>
            </CardContent>
          )}
        </Card>
      ))}

      {c?.antiCheat.enabled && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Timed questions &amp; fair play</CardTitle>
            <p className="text-sm text-muted-foreground">Each day&apos;s question is hidden until you press Start.</p>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
              <li>You have {c.antiCheat.timeLimitSeconds} seconds to answer after pressing Start, checked by the server.</li>
              {c.antiCheat.lockOnLeave && (
                <li>Switching apps or tabs, locking your phone, reloading, or opening the quiz on another device ends that day&apos;s attempt — it&apos;s recorded as missed.</li>
              )}
              {c.antiCheat.shuffleOptions && <li>Options appear in a different order for each participant.</li>}
              {c.antiCheat.watermark && <li>Questions are watermarked with your name, and copying is disabled.</li>}
              {c.antiCheat.requireFullscreen && <li>The quiz opens fullscreen where your browser supports it.</li>}
              <li>Tip: turn on Do Not Disturb before you start so a call or notification doesn&apos;t end your attempt.</li>
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daily schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <p>
            Every question opens at 12:00 AM and closes at 11:59:59 PM in the competition time zone{c ? ` (${c.timezone})` : ""}. The server clock decides —
            changing your device&apos;s time has no effect.
          </p>
          <p>If you don&apos;t answer before the question closes, that day is recorded as missed and scores 0 points. Missed days can&apos;t be answered later.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scoring &amp; leaderboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <ul className="list-disc space-y-1 pl-5">
            <li>Correct answer: +{c?.scoring.pointsPerCorrectAnswer ?? 1} point{(c?.scoring.pointsPerCorrectAnswer ?? 1) === 1 ? "" : "s"} (some questions may be worth more, shown on the question).</li>
            <li>Wrong answer: {c?.scoring.negativeMarking ? `−${c.scoring.negativePoints}` : "0"} points.</li>
            <li>Missed day: 0 points.</li>
          </ul>
          <p>
            Your score, correct answers and rank stay hidden while the competition runs — you&apos;ll only see how many days you&apos;ve answered, missed, and your
            streak. When the competition ends the final leaderboard, correct answers and explanations are revealed.
          </p>
          <div>
            <p className="font-medium">Ranking</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Higher total score ranks higher.</li>
              {(c?.tieBreakers ?? []).map((t) => (
                <li key={t.key}>If still tied: {t.label.charAt(0).toLowerCase() + t.label.slice(1)}.</li>
              ))}
              <li>Participants tied on every criterion share the same rank.</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fair play &amp; corrections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <p>
            One account per person. Multiple accounts, automated submissions and sharing answers are not allowed. We record submission times and basic
            technical metadata to detect abuse; automated signals are always reviewed by a person before any action is taken.
          </p>
          <p>
            If a question turns out to be wrong or ambiguous, administrators may issue a correction. Every correction is documented with a reason, applied
            to all participants equally, and scores are recalculated from the recorded answers. Historical results are never changed silently.
          </p>
        </CardContent>
      </Card>
    </article>
  );
}
