"use client";

import { Lock, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ApiClientError, api } from "@/lib/api/client";

import { TIE_BREAKERS, TIE_BREAKER_LABELS, type TieBreaker } from "@/lib/leaderboard/ranking";
import { COMMON_TIME_ZONES, addDaysToLocalDate, isValidLocalDate } from "@/lib/time/zoned";

export interface CompetitionFormValues {
  name: string;
  description: string;
  category: string;
  dailyStartTime: string;
  dailyEndTime: string;
  startLocalDate: string;
  timezone: string;
  durationDays: number;
  scoring: { pointsPerCorrectAnswer: number; negativeMarking: boolean; negativePoints: number };
  tieBreakers: TieBreaker[];
  leaderboardRevealMode: "AUTOMATIC" | "MANUAL";
  leaderboardRevealLocalDateTime: string;
  registrationOpen: boolean;
  registrationCloseLocalDate: string;
  rules: string[];
}

export function CompetitionForm({
  mode,
  id,
  initial,
  started = false,
}: {
  mode: "create" | "edit";
  id?: string;
  initial: CompetitionFormValues;
  started?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<CompetitionFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof CompetitionFormValues>(k: K, value: CompetitionFormValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const lastDay = useMemo(
    () => (isValidLocalDate(v.startLocalDate) && v.durationDays > 0 ? addDaysToLocalDate(v.startLocalDate, v.durationDays - 1) : "—"),
    [v.startLocalDate, v.durationDays],
  );
  const zones = COMMON_TIME_ZONES.includes(v.timezone as (typeof COMMON_TIME_ZONES)[number]) ? COMMON_TIME_ZONES : [v.timezone, ...COMMON_TIME_ZONES];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const body = started
      ? {
          name: v.name,
          description: v.description,
          rules: v.rules.filter((r) => r.trim()),
          leaderboardRevealMode: v.leaderboardRevealMode,
          leaderboardRevealLocalDateTime: v.leaderboardRevealLocalDateTime,
          registrationOpen: v.registrationOpen,
          registrationCloseLocalDate: v.registrationCloseLocalDate,
        }
      : { ...v, rules: v.rules.filter((r) => r.trim()) };
    try {
      const res = await api<{ id: string }>(mode === "create" ? "/api/admin/competitions" : `/api/admin/competitions/${id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        body,
      });
      toast.success(mode === "create" ? "Competition created as a draft." : "Changes saved.");
      if (mode === "create") router.push(`/admin/competitions/${res.id}`);
      else router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fieldErrors);
        setFormError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const lockNote = started ? (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="size-3" aria-hidden /> Locked after start
    </span>
  ) : undefined;

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      {started && (
        <Alert tone="info" title="This competition has started">
          Dates, time zone, duration and scoring are locked to protect results. Use a question correction if an answer key was wrong.
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field id="name" label="Name" error={errors.name} className="md:col-span-2">
            <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={100} placeholder="October Daily Challenge" />
          </Field>
          <Field id="category" label="Target Team / Category" error={errors.category} hint="Enter a team name or category, or leave as 'All' for company-wide participation.">
            <Input id="category" value={v.category} onChange={(e) => set("category", e.target.value)} disabled={started} maxLength={60} placeholder="e.g. Engineering, Marketing, All" />
          </Field>
          <Field id="description" label="Description" error={errors.description} className="md:col-span-2">
            <Textarea id="description" value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">Schedule {lockNote}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field id="startLocalDate" label="Start date (Day 1)" error={errors.startLocalDate}>
            <Input id="startLocalDate" type="date" value={v.startLocalDate} onChange={(e) => set("startLocalDate", e.target.value)} disabled={started} required />
          </Field>
          <Field id="durationDays" label="Duration (days)" error={errors.durationDays}>
            <Input id="durationDays" type="number" min={1} max={90} value={v.durationDays} onChange={(e) => set("durationDays", Number(e.target.value))} disabled={started} />
          </Field>
          <Field id="timezone" label="Time zone" error={errors.timezone}>
            <Select id="timezone" value={v.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={started}>
              {zones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </Select>
          </Field>
          <Field id="dailyStartTime" label="Daily Quiz Start Time" error={errors.dailyStartTime} hint="Quiz opens each day (HH:MM)">
            <Input id="dailyStartTime" type="time" value={v.dailyStartTime} onChange={(e) => set("dailyStartTime", e.target.value)} disabled={started} />
          </Field>
          <Field id="dailyEndTime" label="Daily Quiz End Time" error={errors.dailyEndTime} hint="Quiz closes each day (HH:MM)">
            <Input id="dailyEndTime" type="time" value={v.dailyEndTime} onChange={(e) => set("dailyEndTime", e.target.value)} disabled={started} />
          </Field>
          <p className="text-sm text-muted-foreground md:col-span-3">
            Runs from <strong className="text-foreground">{v.startLocalDate || "—"}</strong> to <strong className="text-foreground">{lastDay}</strong> (end date,
            inclusive). Each day opens at {v.dailyStartTime || "09:00"} and closes at {v.dailyEndTime || "18:00"} {v.timezone}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2">Scoring {lockNote}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field id="points" label="Points per correct answer" error={errors.scoring}>
            <Input id="points" type="number" min={1} max={100} value={v.scoring.pointsPerCorrectAnswer} disabled={started}
              onChange={(e) => set("scoring", { ...v.scoring, pointsPerCorrectAnswer: Number(e.target.value) })} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Negative marking</span>
            <label className="flex h-10 items-center gap-2 text-sm">
              <Checkbox checked={v.scoring.negativeMarking} disabled={started}
                onChange={(e) => set("scoring", { ...v.scoring, negativeMarking: e.target.checked, negativePoints: e.target.checked ? v.scoring.negativePoints || 1 : 0 })} />
              Deduct points for wrong answers
            </label>
          </div>
          <Field id="negativePoints" label="Points deducted" hint="Missed days always score 0.">
            <Input id="negativePoints" type="number" min={0} max={100} value={v.scoring.negativePoints} disabled={started || !v.scoring.negativeMarking}
              onChange={(e) => set("scoring", { ...v.scoring, negativePoints: Number(e.target.value) })} />
          </Field>
          <fieldset className="md:col-span-3">
            <legend className="text-sm font-medium">Tie-breakers (applied in this order after total score)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {TIE_BREAKERS.map((tb) => {
                const idx = v.tieBreakers.indexOf(tb);
                return (
                  <label key={tb} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                    <Checkbox className="mt-0.5" checked={idx >= 0} disabled={started}
                      onChange={(e) => set("tieBreakers", e.target.checked ? [...v.tieBreakers, tb] : v.tieBreakers.filter((x) => x !== tb))} />
                    <span>
                      {idx >= 0 && <span className="mr-1 font-semibold">{idx + 1}.</span>}
                      {TIE_BREAKER_LABELS[tb]}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Registration & leaderboard</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Registration</span>
            <label className="flex h-10 items-center gap-2 text-sm">
              <Checkbox checked={v.registrationOpen} onChange={(e) => set("registrationOpen", e.target.checked)} /> Open for new participants
            </label>
          </div>
          <Field id="registrationCloseLocalDate" label="Registration closes (optional)" error={errors.registrationCloseLocalDate} hint="Defaults to the end of the competition.">
            <Input id="registrationCloseLocalDate" type="date" value={v.registrationCloseLocalDate} onChange={(e) => set("registrationCloseLocalDate", e.target.value)} />
          </Field>
          <Field id="revealMode" label="Leaderboard reveal">
            <Select id="revealMode" value={v.leaderboardRevealMode} onChange={(e) => set("leaderboardRevealMode", e.target.value as "AUTOMATIC" | "MANUAL")}>
              <option value="AUTOMATIC">Automatic — when the competition ends</option>
              <option value="MANUAL">Manual — an admin reveals it</option>
            </Select>
          </Field>
          <Field id="revealAt" label="Automatic reveal at (optional)" error={errors.leaderboardRevealLocalDateTime} hint="Never earlier than the end of the final day.">
            <Input id="revealAt" type="datetime-local" value={v.leaderboardRevealLocalDateTime} disabled={v.leaderboardRevealMode === "MANUAL"}
              onChange={(e) => set("leaderboardRevealLocalDateTime", e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Shown on /rules. Leave empty to use the default rules.</p>
          {v.rules.map((r, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Rule ${i + 1}`} value={r} maxLength={500} onChange={(e) => set("rules", v.rules.map((x, j) => (j === i ? e.target.value : x)))} />
              <Button variant="ghost" size="icon" aria-label={`Remove rule ${i + 1}`} onClick={() => set("rules", v.rules.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => set("rules", [...v.rules, ""])}>
            <Plus /> Add rule
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={busy} loadingText={mode === "create" ? "Creating…" : "Saving…"}>
          {mode === "create" ? "Create competition" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
