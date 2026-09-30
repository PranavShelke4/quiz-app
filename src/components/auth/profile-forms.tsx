"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui/primitives";
import { ApiClientError, api } from "@/lib/api/client";
import { COMPANY_TEAMS } from "@/lib/teams";
import { PASSWORD_RULES } from "@/lib/validation/auth";

export function ProfileForms({ name, avatar, team = "General" }: { name: string; avatar: string; team?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"profile" | "password" | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Public profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setBusy("profile");
              setErrors({});
              try {
                await api("/api/profile", {
                  method: "PATCH",
                  body: { name: fd.get("name"), avatar: fd.get("avatar"), team: fd.get("team") },
                });
                toast.success("Profile saved.");
                router.refresh();
              } catch (err) {
                if (err instanceof ApiClientError) {
                  setErrors(err.fieldErrors);
                  toast.error(err.message);
                }
              } finally {
                setBusy(null);
              }
            }}
          >
            <Field id="name" label="Display name" error={errors.name} hint="Shown on the final leaderboard.">
              <Input id="name" name="name" defaultValue={name} required maxLength={60} autoComplete="name" />
            </Field>
            <Field id="team" label="Team / Department" error={errors.team} hint="Your team for team-based competitions and leaderboards.">
              <Select id="team" name="team" defaultValue={team}>
                {COMPANY_TEAMS.filter((t) => t !== "All").map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field id="avatar" label="Avatar URL (optional)" error={errors.avatar} hint="An https:// image URL.">
              <Input id="avatar" name="avatar" type="url" defaultValue={avatar} placeholder="https://…" />
            </Field>
            <Button type="submit" loading={busy === "profile"} loadingText="Saving…">
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              setBusy("password");
              setErrors({});
              try {
                await api("/api/auth/change-password", { body: { currentPassword: fd.get("currentPassword"), newPassword: fd.get("newPassword") } });
                toast.success("Password updated. Other devices were signed out.");
                form.reset();
              } catch (err) {
                if (err instanceof ApiClientError) {
                  setErrors(err.fieldErrors);
                  toast.error(err.message);
                }
              } finally {
                setBusy(null);
              }
            }}
          >
            <Field id="currentPassword" label="Current password" error={errors.currentPassword}>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field id="newPassword" label="New password" error={errors.newPassword} hint={PASSWORD_RULES.join(" · ")}>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
            </Field>
            <Button type="submit" variant="outline" loading={busy === "password"} loadingText="Updating…">
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
