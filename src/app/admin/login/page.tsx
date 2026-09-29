import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <span className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <CardTitle className="text-xl">Admin sign in</CardTitle>
          <CardDescription>Restricted area. All admin activity is logged.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <LoginForm admin />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
