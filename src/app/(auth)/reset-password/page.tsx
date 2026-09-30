import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { tokenSchema } from "@/lib/validation/auth";

export const metadata: Metadata = { title: "Set a new password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && tokenSchema.safeParse(token).success;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>After resetting, you&apos;ll be signed out on all devices.</CardDescription>
      </CardHeader>
      <CardContent>
        {valid ? (
          <ResetPasswordForm token={token} />
        ) : (
          <Alert tone="danger" title="Invalid link">This reset link is invalid or incomplete. Ask an admin for a new one.</Alert>
        )}
      </CardContent>
    </Card>
  );
}
