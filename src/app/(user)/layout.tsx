import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { EmptyState } from "@/components/ui/primitives";
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
