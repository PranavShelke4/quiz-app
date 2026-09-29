import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileQuestion, Trophy } from "lucide-react";
import { CompetitionActions } from "@/components/admin/competition-actions";
import { CompetitionForm } from "@/components/admin/competition-form";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, StatCard } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/utils";
import { getCompetitionById, getPublishReadiness, toAdminCompetition } from "@/services/competition.service";
import { listCorrections } from "@/services/question.service";

export const metadata: Metadata = { title: "Competition" };

export default async function CompetitionDetailPage({ params }: PageProps<"/admin/competitions/[id]">) {
  await requireAdmin("competitions:manage");
  const { id } = await params;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  let comp;
  try {
    comp = await getCompetitionById(id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const c = toAdminCompetition(comp);
  const [readiness, corrections] = await Promise.all([getPublishReadiness(comp), listCorrections(id)]);
  const started = c.phase !== "NOT_STARTED";

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/admin/competitions" className="hover:underline">Competitions</Link> / <span className="text-foreground">{c.name}</span>
      </nav>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{c.status}</Badge>
            {c.phase === "ACTIVE" && <Badge tone="success">Day {c.currentDay} / {c.durationDays}</Badge>}
            <span>{formatDateTime(c.startsAt, c.timezone)} → {formatDateTime(c.endsAt, c.timezone)} ({c.timezone})</span>
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/admin/questions?competitionId=${c.id}`} variant="outline" size="sm"><FileQuestion /> Questions</ButtonLink>
            <ButtonLink href={`/admin/leaderboard?competitionId=${c.id}`} variant="outline" size="sm"><Trophy /> Leaderboard</ButtonLink>
          </>
        }
      />

      <Card>
        <CardHeader><CardTitle>Lifecycle</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Published questions" value={`${readiness.publishedCount}/${c.durationDays}`} />
            <StatCard label="Leaderboard" value={<span className="text-base">{c.leaderboardRevealed ? "Revealed" : "Hidden"}</span>} hint={c.leaderboardRevealMode === "AUTOMATIC" ? "Auto-reveal" : "Manual reveal"} />
            <StatCard label="Finalized" value={<span className="text-base">{c.finalizedAt ? formatDateTime(c.finalizedAt, c.timezone) : "Not yet"}</span>} />
            <StatCard label="Published at" value={<span className="text-base">{c.publishedAt ? formatDateTime(c.publishedAt, c.timezone) : "Draft"}</span>} />
          </div>
          {c.status === "DRAFT" && !readiness.ready && (
            <Alert tone="warning" title="Not ready to publish">
              Missing published questions for day {readiness.missingDays.slice(0, 15).join(", ")}
              {readiness.missingDays.length > 15 ? "…" : ""}.
            </Alert>
          )}
          <CompetitionActions id={c.id} name={c.name} status={c.status} phase={c.phase} ready={readiness.ready} />
        </CardContent>
      </Card>

      {c.status !== "ARCHIVED" && (
        <CompetitionForm
          mode="edit"
          id={c.id}
          started={started}
          initial={{
            name: c.name,
            description: c.description,
            startLocalDate: c.startLocalDate,
            timezone: c.timezone,
            durationDays: c.durationDays,
            scoring: c.scoring,
            tieBreakers: c.tieBreakers,
            leaderboardRevealMode: c.leaderboardRevealMode,
            leaderboardRevealLocalDateTime: c.leaderboardRevealLocalDateTime,
            registrationOpen: c.registrationOpen,
            registrationCloseLocalDate: c.registrationCloseLocalDate,
            rules: c.rules,
          }}
        />
      )}

      <Card>
        <CardHeader><CardTitle>Correction history</CardTitle></CardHeader>
        <CardContent>
          {corrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No corrections have been issued.</p>
          ) : (
            <ul className="divide-y text-sm">
              {corrections.map((x) => (
                <li key={String(x._id)} className="py-3">
                  <p className="font-medium">
                    Day {x.dayNumber}: {x.oldValue.correctOptionId} → {x.newValue.correctOptionId}
                    {x.oldValue.points !== x.newValue.points && ` · points ${x.oldValue.points ?? "default"} → ${x.newValue.points ?? "default"}`}
                  </p>
                  <p className="text-muted-foreground">{x.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {x.adminId?.name ?? "Admin"} · {formatDateTime(x.createdAt, c.timezone)} · {x.affectedAnswers} answers recalculated
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
