"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const USER_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/quiz", label: "Today's quiz" },
  { href: "/leaderboard", label: "Leaderboard" },
];

/** Participant navigation with the current page highlighted (desktop row or mobile strip). */
export function MainNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (variant === "desktop") {
    return (
      <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
        {USER_NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={isActive(n.href) ? "page" : undefined}
            className={cn(
              "relative rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
              isActive(n.href) && "font-medium text-primary after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-brand",
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label="Main" className="grid grid-cols-3 border-t md:hidden">
      {USER_NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={isActive(n.href) ? "page" : undefined}
          className={cn(
            "flex h-11 items-center justify-center border-b-2 border-transparent text-sm text-muted-foreground",
            isActive(n.href) && "border-brand font-medium text-primary",
          )}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
