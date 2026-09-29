import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { ResendVerificationButton } from "@/components/auth/auth-forms";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { Alert, EmptyState } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/dal";
import { isAdminRole } from "@/lib/auth/rbac";
import { getSettings } from "@/services/settings.service";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireUser();
  const settings = await getSettings();
  const maintenance = settings.platform.maintenanceMode && !isAdminRole(auth.user.role);

  return (
    <>
      <SiteHeader user={auth.user} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {!auth.user.isEmailVerified && !maintenance && (
          <Alert tone="warning" title="Verify your email to compete" className="mb-6" action={<ResendVerificationButton />}>
            We sent a link to {auth.user.email}. You can browse, but you&apos;ll need a verified email to submit answers.
          </Alert>
        )}
        {maintenance ? (
          <EmptyState icon={<Wrench />} title="We'll be right back" description="The platform is undergoing maintenance. Your answers and progress are safe." />
        ) : (
          children
        )}
      </main>
      <SiteFooter />
    </>
  );
}
