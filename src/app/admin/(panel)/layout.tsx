import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { AdminMobileNav, AdminSidebar } from "@/components/admin/sidebar";
import { Avatar, Badge } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth/dal";
import { brandLogos } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  // Server-side authorization for every admin page (proxy only does a cookie-presence check).
  const auth = await requireAdmin();
  const isSuper = auth.user.role === "SUPER_ADMIN";
  const logos = brandLogos();
  return (
    <div className="flex min-h-dvh">
      <AdminSidebar isSuper={isSuper} logos={logos} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <AdminMobileNav isSuper={isSuper} logos={logos} />
            <span className="truncate font-semibold lg:hidden">Quiz Admin</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Kept away from the mobile menu button so it can't be hit by accident; on phones it lives in the menu. */}
            <Link href="/" className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex">
              <ExternalLink className="size-4" aria-hidden /> View site
            </Link>
            <span className="hidden sm:inline-flex">
              <Badge tone={isSuper ? "primary" : "neutral"}>{isSuper ? "Super admin" : "Admin"}</Badge>
            </span>
            <Avatar name={auth.user.name} src={auth.user.avatar} />
            <span className="hidden text-sm font-medium sm:inline">{auth.user.name}</span>
            <LogoutButton compact redirectTo="/admin/login" />
          </div>
        </header>
        <main id="main" className="flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
