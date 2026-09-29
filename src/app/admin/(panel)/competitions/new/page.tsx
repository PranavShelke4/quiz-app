import type { Metadata } from "next";
import { CompetitionForm } from "@/components/admin/competition-form";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth/dal";
import { DEFAULT_TIE_BREAKERS } from "@/lib/leaderboard/ranking";
import { now } from "@/lib/time/clock";
import { addDaysToLocalDate, localDateInZone } from "@/lib/time/zoned";
import { getSettings } from "@/services/settings.service";

export const metadata: Metadata = { title: "New competition" };

export default async function NewCompetitionPage() {
  await requireAdmin("competitions:manage");
  const { competitionDefaults: d } = await getSettings();
  // Default: the 1st of next month in the default time zone.
  const today = localDateInZone(now(), d.timezone);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const firstOfNext = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const start = firstOfNext > today ? firstOfNext : addDaysToLocalDate(today, 1);
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${start}T00:00:00Z`));

  return (
    <>
      <PageHeader title="Create competition" description="Competitions start as drafts. Add a question for every day, then publish." />
      <CompetitionForm
        mode="create"
        initial={{
          name: `${monthName} Daily Challenge`,
          description: "",
          startLocalDate: start,
          timezone: d.timezone,
          durationDays: d.durationDays,
          scoring: { pointsPerCorrectAnswer: d.pointsPerCorrectAnswer, negativeMarking: false, negativePoints: 0 },
          tieBreakers: [...DEFAULT_TIE_BREAKERS],
          leaderboardRevealMode: "AUTOMATIC",
          leaderboardRevealLocalDateTime: "",
          registrationOpen: true,
          registrationCloseLocalDate: "",
          rules: [],
        }}
      />
    </>
  );
}
