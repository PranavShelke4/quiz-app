"use client";

import { Lock, LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { ApiClientError } from "@/lib/api/client";
import { COMMON_TIME_ZONES } from "@/lib/time/zoned";
import type { PlatformSettings } from "@/services/settings.service";

export function SettingsForm({ initial, isSuper }: { initial: PlatformSettings; isSuper: boolean }) {
  const { run, fire } = useAction();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  async function save(section: "general" | "sensitive") {
    setBusy(section);
    try {
      const body =
        section === "general"
          ? { competitionDefaults: s.competitionDefaults, notifications: s.notifications }
          : { security: s.security, platform: s.platform };
      await run("save", "/api/admin/settings", { method: "PATCH", body }, "Settings saved.");
    } catch (e) {
      if (!(e instanceof ApiClientError)) toast.error("Couldn't save settings.");
    } finally {
      setBusy(null);
    }
  }

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const lock = !isSuper;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Competition defaults</CardTitle><CardDescription>Pre-filled when creating a competition.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field id="d-dur" label="Default duration (days)">
            <Input id="d-dur" type="number" min={1} max={90} value={s.competitionDefaults.durationDays} onChange={(e) => setS({ ...s, competitionDefaults: { ...s.competitionDefaults, durationDays: num(e.target.value) } })} />
          </Field>
          <Field id="d-pts" label="Default points">
            <Input id="d-pts" type="number" min={1} max={100} value={s.competitionDefaults.pointsPerCorrectAnswer} onChange={(e) => setS({ ...s, competitionDefaults: { ...s.competitionDefaults, pointsPerCorrectAnswer: num(e.target.value) } })} />
          </Field>
          <Field id="d-tz" label="Default time zone">
            <Select id="d-tz" value={s.competitionDefaults.timezone} onChange={(e) => setS({ ...s, competitionDefaults: { ...s.competitionDefaults, timezone: e.target.value } })}>
              {[...new Set([s.competitionDefaults.timezone, ...COMMON_TIME_ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={s.notifications.dailyReminderEnabled} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, dailyReminderEnabled: e.target.checked } })} /> Daily reminder</label>
          <Field id="n-hour" label="Daily reminder hour (competition time)">
            <Input id="n-hour" type="number" min={0} max={23} value={s.notifications.dailyReminderHour} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, dailyReminderHour: num(e.target.value) } })} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={s.notifications.deadlineReminderEnabled} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, deadlineReminderEnabled: e.target.checked } })} /> Deadline reminder</label>
          <Field id="n-before" label="Hours before the deadline">
            <Input id="n-before" type="number" min={1} max={12} value={s.notifications.deadlineReminderHoursBefore} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, deadlineReminderHoursBefore: num(e.target.value) } })} />
          </Field>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={() => save("general")} loading={busy === "general"} loadingText="Saving…">Save defaults & notifications</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Security & platform {lock && <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><Lock className="size-3" aria-hidden /> Super admin only</span>}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {([
            ["sessionMaxDays", "Session lifetime (days)", 1, 90],
            ["sessionIdleDays", "Idle timeout (days)", 1, 90],
            ["adminSessionHours", "Admin session (hours)", 1, 72],
            ["loginAttemptLimit", "Failed logins before lock", 3, 20],
            ["lockoutMinutes", "Lockout (minutes)", 1, 1440],
            ["loginRateLimitPerIp", "Login attempts / IP / 15 min", 5, 1000],
            ["signupRateLimitPerIp", "Sign-ups / IP / hour", 1, 1000],
          ] as const).map(([key, label, min, max]) => (
            <Field key={key} id={`s-${key}`} label={label}>
              <Input id={`s-${key}`} type="number" min={min} max={max} disabled={lock} value={s.security[key]} onChange={(e) => setS({ ...s, security: { ...s.security, [key]: num(e.target.value) } })} />
            </Field>
          ))}
          <div className="space-y-2 md:col-span-3">
            <label className="flex items-center gap-2 text-sm"><Checkbox disabled={lock} checked={s.platform.registrationEnabled} onChange={(e) => setS({ ...s, platform: { ...s.platform, registrationEnabled: e.target.checked } })} /> Registration enabled</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox disabled={lock} checked={s.platform.maintenanceMode} onChange={(e) => setS({ ...s, platform: { ...s.platform, maintenanceMode: e.target.checked } })} /> Maintenance mode (participants see a maintenance page; admins are unaffected)</label>
          </div>
        </CardContent>
      </Card>
      {isSuper && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="danger" onClick={() => setConfirmLogout(true)}><LogOut /> Sign out all users</Button>
          <Button onClick={() => save("sensitive")} loading={busy === "sensitive"} loadingText="Saving…">Save security & platform</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Sign out every user?"
        description="Every session on the platform is invalidated immediately, including other admins. You'll stay signed in."
        confirmText="SIGN OUT EVERYONE"
        confirmLabel="Sign out all users"
        loadingLabel="Signing out…"
        onConfirm={async () => {
          await fire("global-logout", "/api/admin/settings/global-logout", { body: {} }, "All sessions invalidated.");
          setConfirmLogout(false);
        }}
      />
    </div>
  );
}
