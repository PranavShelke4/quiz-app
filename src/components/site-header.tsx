import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { BrandMark } from "@/components/brand-mark";
import { MainNav } from "@/components/main-nav";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/primitives";
import type { SessionUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/rbac";
import { APP_NAME, brandLogos } from "@/lib/brand";

export function Logo({ tone = "default" }: { tone?: "default" | "inverse" }) {
  return (
    <Link href="/" aria-label={`${APP_NAME} home`} className="rounded-md">
      <BrandMark logos={brandLogos()} appName={APP_NAME} tone={tone} />
    </Link>
  );
}

export function SiteHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="brand-stripe h-1" aria-hidden />
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-8">
          <Logo />
          {user && <MainNav variant="desktop" />}
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              {isAdminRole(user.role) && (
                <ButtonLink href="/admin/dashboard" variant="ghost" size="sm" className="hidden sm:inline-flex">
                  Admin
                </ButtonLink>
              )}
              <Link href="/profile" className="flex items-center gap-2 rounded-full p-0.5 hover:bg-muted sm:pr-3" aria-label="Your profile">
                <Avatar name={user.name} src={user.avatar} />
                <span className="hidden text-sm font-medium sm:inline">{user.name.split(" ")[0]}</span>
              </Link>
              <LogoutButton compact />
            </>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Join
              </ButtonLink>
            </>
          )}
        </div>
      </div>
      {user && <MainNav variant="mobile" />}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-brand-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-[1fr_auto] sm:items-end sm:px-6">
        <div className="space-y-2">
          <Logo tone="inverse" />
          <p className="max-w-sm text-sm text-white/75">An internal quiz for ICICI Bank colleagues. One question a day, results revealed at the end.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/rules" className="text-white/85 hover:text-white hover:underline">Rules</Link>
          <Link href="/privacy" className="text-white/85 hover:text-white hover:underline">Privacy</Link>
          <Link href="/terms" className="text-white/85 hover:text-white hover:underline">Terms</Link>
        </nav>
      </div>
      <div className="border-t border-white/15">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-white/60 sm:px-6">© {new Date().getFullYear()} {APP_NAME}. For internal use.</p>
      </div>
    </footer>
  );
}
