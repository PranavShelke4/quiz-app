import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { AdminMobileNav, AdminSidebar } from "@/components/admin/sidebar";
import { Avatar, Badge } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  // Server-side authorization for every admin page (proxy only does a cookie-presence check).
  const auth = await requireAdmin();
  const isSuper = auth.user.role === "SUPER_ADMIN";
  return (
    <div className="flex min-h-dvh">
      <AdminSidebar isSuper={isSuper} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <AdminMobileNav isSuper={isSuper} />
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              ← View site
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={isSuper ? "primary" : "neutral"}>{isSuper ? "Super admin" : "Admin"}</Badge>
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
