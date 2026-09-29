import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { ResendVerificationButton } from "@/components/auth/auth-forms";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { getAuth } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { tokenSchema } from "@/lib/validation/auth";
import { verifyEmail } from "@/services/auth.service";

export const metadata: Metadata = { title: "Verify email", referrer: "no-referrer" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams;
  const auth = await getAuth();

  let status: "verified" | "invalid" | "pending" = "pending";
  if (typeof token === "string") {
    if (!tokenSchema.safeParse(token).success) status = "invalid";
    else {
      try {
        await verifyEmail(token);
        status = "verified";
      } catch (e) {
        if (!isAppError(e)) throw e;
        status = "invalid";
      }
    }
  }
  if (status !== "verified" && auth?.user.isEmailVerified) status = "verified";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Email verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "verified" && (
          <>
            <div className="flex items-center gap-3 rounded-lg bg-success-soft p-4 text-success">
              <CheckCircle2 aria-hidden />
              <p className="font-medium">Your email is verified. You&apos;re ready to compete.</p>
            </div>
            <ButtonLink href={auth ? "/dashboard" : "/login"} className="w-full">
              {auth ? "Go to dashboard" : "Sign in"}
            </ButtonLink>
          </>
        )}
        {status === "invalid" && (
          <>
            <Alert tone="danger" title="This link is invalid or has expired">
              Verification links expire after 24 hours and can only be used once.
            </Alert>
            {auth ? <ResendVerificationButton /> : <ButtonLink href="/login" variant="outline">Sign in to request a new link</ButtonLink>}
          </>
        )}
        {status === "pending" && (
          <>
            <p className="text-sm text-muted-foreground">
              We sent a verification link to {auth ? <strong className="text-foreground">{auth.user.email}</strong> : "your email"}. Click it to activate
              your account.
            </p>
            {auth && <ResendVerificationButton />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
