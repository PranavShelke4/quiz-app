"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { ApiClientError, api } from "@/lib/api/client";
import { COMPANY_TEAMS } from "@/lib/teams";
import { safeNextPath } from "@/lib/utils";
import { PASSWORD_RULES } from "@/lib/validation/auth";

type Errors = Record<string, string[] | undefined>;

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
        setFormError(e.code === "VALIDATION_ERROR" && Object.keys(e.fieldErrors).length ? "Please fix the highlighted fields." : e.message);
      } else setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, errors, formError, run };
}

function fieldProps(name: string, errors: Errors) {
  const invalid = !!errors[name]?.length;
  return { id: name, name, "aria-invalid": invalid || undefined, "aria-describedby": invalid ? `${name}-error` : undefined };
}

export function LoginForm({ admin = false }: { admin?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const { busy, errors, formError, run } = useSubmit();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(async () => {
      await api(admin ? "/api/admin/auth/login" : "/api/auth/login", {
        body: { email: fd.get("email"), password: fd.get("password") },
      });
      router.replace(safeNextPath(params.get("next"), admin ? "/admin/dashboard" : "/dashboard"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Field id="email" label="Email" error={errors.email}>
        <Input {...fieldProps("email", errors)} type="email" autoComplete="email" required inputMode="email" />
      </Field>
      <Field id="password" label="Password" error={errors.password}>
        <Input {...fieldProps("password", errors)} type="password" autoComplete="current-password" required />
      </Field>
      {!admin && <p className="text-right text-sm text-muted-foreground">Forgot password? Ask an admin for a reset link.</p>}
      <Button type="submit" className="w-full" size="lg" loading={busy} loadingText="Signing in…">
        Sign in
      </Button>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const { busy, errors, formError, run } = useSubmit();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(async () => {
      await api("/api/auth/signup", {
        body: {
          name: fd.get("name"),
          email: fd.get("email"),
          password: fd.get("password"),
          team: fd.get("team") || "General",
          acceptTerms: fd.get("acceptTerms") === "on",
        },
      });
      toast.success("Account created.");
      router.replace("/dashboard");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Field id="name" label="Name" error={errors.name} hint="Shown on the final leaderboard.">
        <Input {...fieldProps("name", errors)} autoComplete="name" required maxLength={60} />
      </Field>
      <Field id="team" label="Team / Department" error={errors.team} hint="Select your team or department.">
        <Select id="team" name="team" defaultValue="Engineering">
          {COMPANY_TEAMS.filter((t) => t !== "All").map((team) => (
            <option key={team} value={team}>{team}</option>
          ))}
        </Select>
      </Field>
      <Field id="email" label="Email" error={errors.email}>
        <Input {...fieldProps("email", errors)} type="email" autoComplete="email" required inputMode="email" />
      </Field>
      <Field id="password" label="Password" error={errors.password} hint={PASSWORD_RULES.join(" · ")}>
        <Input {...fieldProps("password", errors)} type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox name="acceptTerms" className="mt-0.5" aria-invalid={!!errors.acceptTerms || undefined} />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="text-primary hover:underline" target="_blank">
              terms
            </Link>
            ,{" "}
            <Link href="/rules" className="text-primary hover:underline" target="_blank">
              rules
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary hover:underline" target="_blank">
              privacy policy
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms && <p className="text-xs text-danger">{errors.acceptTerms[0]}</p>}
      </div>
      <Button type="submit" className="w-full" size="lg" loading={busy} loadingText="Creating account…">
        Create account
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { busy, errors, formError, run } = useSubmit();
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (fd.get("password") !== fd.get("confirm")) {
          toast.error("Passwords don't match.");
          return;
        }
        run(async () => {
          await api("/api/auth/reset-password", { body: { token, password: fd.get("password") } });
          toast.success("Password updated. Please sign in.");
          router.replace("/login");
        });
      }}
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Field id="password" label="New password" error={errors.password} hint={PASSWORD_RULES.join(" · ")}>
        <Input {...fieldProps("password", errors)} type="password" autoComplete="new-password" required />
      </Field>
      <Field id="confirm" label="Confirm new password">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={busy} loadingText="Saving…">
        Set new password
      </Button>
    </form>
  );
}
