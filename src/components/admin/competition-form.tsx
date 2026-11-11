"use client";

import { ArrowDown, ArrowUp, Lock, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ApiClientError, api } from "@/lib/api/client";

import { TIE_BREAKERS, TIE_BREAKER_LABELS, type TieBreaker } from "@/lib/leaderboard/ranking";
import { MAX_TIME_LIMIT_SECONDS, MIN_TIME_LIMIT_SECONDS, type AntiCheatSettings } from "@/lib/quiz/anticheat-config";
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
  ruleSections: RuleSectionValue[];
  antiCheat: AntiCheatSettings;
}

export interface RuleSectionValue {
  title: string;
  description: string;
  rules: string[];
}

/** Drops blank rules and fully empty sections before saving. */
function cleanSections(sections: RuleSectionValue[]): RuleSectionValue[] {
  return sections
    .map((s) => ({ title: s.title.trim(), description: s.description.trim(), rules: s.rules.map((r) => r.trim()).filter(Boolean) }))
    .filter((s) => s.title || s.description || s.rules.length);
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
    const ruleSections = cleanSections(v.ruleSections);
    const untitled = ruleSections.findIndex((s) => !s.title);
    if (untitled !== -1) {
      setBusy(false);
      setErrors({ ruleSections: [`Section ${untitled + 1} needs a title.`] });
      setFormError("Please fix the highlighted fields.");
      return;
    }
    const body = started
      ? {
          name: v.name,
          description: v.description,
          ruleSections,
          antiCheat: v.antiCheat,
          leaderboardRevealMode: v.leaderboardRevealMode,
          leaderboardRevealLocalDateTime: v.leaderboardRevealLocalDateTime,
          registrationOpen: v.registrationOpen,
          registrationCloseLocalDate: v.registrationCloseLocalDate,
        }
      : { ...v, ruleSections };
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
          <Field id="category" label="Target Track / Category" error={errors.category} hint="Enter a track or category, or leave as 'All' for company-wide participation.">
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

      <AntiCheatCard value={v.antiCheat} onChange={(antiCheat) => set("antiCheat", antiCheat)} error={errors.antiCheat} />

      <RulesEditor sections={v.ruleSections} onChange={(sections) => set("ruleSections", sections)} error={errors.ruleSections} />

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={busy} loadingText={mode === "create" ? "Creating…" : "Saving…"}>
          {mode === "create" ? "Create competition" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function RulesEditor({ sections, onChange, error }: { sections: RuleSectionValue[]; onChange: (s: RuleSectionValue[]) => void; error?: string[] }) {
  const update = (i: number, patch: Partial<RuleSectionValue>) => onChange(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...sections];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    onChange(next);
  };

  return (
    <Card>
      <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Shown on /rules. Group rules into sections, each with a title and a short description. Leave empty to use the default rules.
        </p>
        {error && <p className="text-xs text-danger">{error[0]}</p>}
        {sections.map((section, i) => (
          <div key={i} className="space-y-3 rounded-xl border p-3 sm:p-4">
            <div className="flex items-start gap-2">
              <span className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Section {i + 1}</span>
              <div className="ml-auto flex gap-0.5">
                <Button variant="ghost" size="icon" aria-label={`Move section ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon" aria-label={`Move section ${i + 1} down`} disabled={i === sections.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button variant="ghost" size="icon" aria-label={`Remove section ${i + 1}`} onClick={() => onChange(sections.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            </div>
            <Field id={`rs-title-${i}`} label="Section title">
              <Input id={`rs-title-${i}`} value={section.title} maxLength={100} placeholder="e.g. Scoring" onChange={(e) => update(i, { title: e.target.value })} />
            </Field>
            <Field id={`rs-desc-${i}`} label="Short description" hint="Optional. Shown under the title.">
              <Textarea id={`rs-desc-${i}`} value={section.description} maxLength={500} rows={2} className="min-h-0" onChange={(e) => update(i, { description: e.target.value })} />
            </Field>
            <div className="space-y-2">
              <span className="text-sm font-medium">Rules in this section</span>
              {section.rules.map((r, k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{k + 1}.</span>
                  <Input
                    aria-label={`Section ${i + 1}, rule ${k + 1}`}
                    value={r}
                    maxLength={500}
                    onChange={(e) => update(i, { rules: section.rules.map((x, j) => (j === k ? e.target.value : x)) })}
                  />
                  <Button variant="ghost" size="icon" aria-label={`Remove rule ${k + 1} of section ${i + 1}`} onClick={() => update(i, { rules: section.rules.filter((_, j) => j !== k) })}>
                    <X />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" disabled={section.rules.length >= 30} onClick={() => update(i, { rules: [...section.rules, ""] })}>
                <Plus /> Add rule
              </Button>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" disabled={sections.length >= 15} onClick={() => onChange([...sections, { title: "", description: "", rules: [""] }])}>
          <Plus /> Add section
        </Button>
      </CardContent>
    </Card>
  );
}

function AntiCheatCard({ value, onChange, error }: { value: AntiCheatSettings; onChange: (v: AntiCheatSettings) => void; error?: string[] }) {
  const set = <K extends keyof AntiCheatSettings>(k: K, v: AntiCheatSettings[K]) => onChange({ ...value, [k]: v });
  const toggles: { key: Exclude<keyof AntiCheatSettings, "enabled" | "timeLimitSeconds">; label: string; hint: string }[] = [
    { key: "lockOnLeave", label: "Lock on leave", hint: "Switching app/tab, locking the phone, reloading or opening the quiz on a second device ends the attempt as missed and raises a review flag." },
    { key: "shuffleOptions", label: "Shuffle options", hint: "Each participant sees the options in a different order, so sharing a letter is useless." },
    { key: "watermark", label: "Watermark & no copy", hint: "Faint name/email watermark over the question; copy, right-click and long-press are blocked." },
    { key: "flagFastAnswers", label: "Flag too-fast answers", hint: "Flags correct answers submitted faster than the question and options can be read (at least 2 s). Never changes the score." },
    { key: "requireFullscreen", label: "Fullscreen (where supported)", hint: "Asks for fullscreen on Start; leaving it counts as leaving. iPhones don't support it and are never penalised for that." },
  ];
  return (
    <Card>
      <CardHeader><CardTitle>Anti-cheat</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={value.enabled} onChange={(e) => set("enabled", e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-medium">Timed attempts</span>
            <span className="block text-muted-foreground">The question stays hidden until the participant presses Start, then must be answered within the time limit (checked by the server).</span>
          </span>
        </label>
        {error && <p className="text-xs text-danger">{error[0]}</p>}
        <fieldset disabled={!value.enabled} className="space-y-4 disabled:opacity-50">
          <Field id="ac-time" label="Time limit (seconds)" hint={`${MIN_TIME_LIMIT_SECONDS}–${MAX_TIME_LIMIT_SECONDS}. 30–60 s leaves no time to search for answers.`}>
            <Input
              id="ac-time"
              type="number"
              min={MIN_TIME_LIMIT_SECONDS}
              max={MAX_TIME_LIMIT_SECONDS}
              value={value.timeLimitSeconds}
              onChange={(e) => set("timeLimitSeconds", Number(e.target.value))}
              className="max-w-40"
            />
          </Field>
          {toggles.map((t) => (
            <label key={t.key} className="flex items-start gap-3 text-sm">
              <Checkbox checked={value[t.key]} onChange={(e) => set(t.key, e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium">{t.label}</span>
                <span className="block text-muted-foreground">{t.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted-foreground">
          No website can block screenshots or a second phone. The timer, shuffling and watermark make those far less useful.
        </p>
      </CardContent>
    </Card>
  );
}
