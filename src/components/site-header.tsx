import Link from "next/link";
import { Trophy } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/primitives";
import type { SessionUser } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/rbac";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Trophy className="size-4" aria-hidden />
      </span>
      <span>Daily Quiz</span>
    </Link>
  );
}

const USER_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/quiz", label: "Today's quiz" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          {user && (
            <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
              {USER_NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
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
      {user && (
        <nav aria-label="Main mobile" className="flex gap-1 overflow-x-auto border-t px-2 py-1.5 md:hidden">
          {USER_NAV.map((n) => (
            <Link key={n.href} href={n.href} className="shrink-0 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} Daily Quiz</p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="/rules" className="hover:text-foreground">Rules</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
