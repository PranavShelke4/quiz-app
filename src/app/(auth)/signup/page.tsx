import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SignupForm } from "@/components/auth/auth-forms";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { getSettings } from "@/services/settings.service";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  await connection(); // registration status is read at request time
  const settings = await getSettings().catch(() => null);
  const closed = settings ? !settings.platform.registrationEnabled : false;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Join the competition</CardTitle>
        <CardDescription>One question a day. Results revealed at the end.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {closed ? <Alert tone="warning" title="Registration is closed">New sign-ups are paused right now. Please check back later.</Alert> : <SignupForm />}
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
