"use client";

import {
  BarChart3,
  ClipboardList,
  FileQuestion,
  Flag,
  LayoutDashboard,
  Menu,
  ScrollText,
  Settings,
  Trophy,
  Users,
  CalendarRange,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/competitions", label: "Competitions", icon: CalendarRange },
  { href: "/admin/questions", label: "Questions", icon: FileQuestion },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/answers", label: "Answers", icon: ClipboardList },
  { href: "/admin/flags", label: "Review flags", icon: Flag },
  { href: "/admin/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText, superOnly: true },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

function NavLinks({ isSuper, onNavigate }: { isSuper: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {NAV.filter((n) => !n.superOnly || isSuper).map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active && "bg-primary-soft font-medium text-primary-soft-foreground hover:bg-primary-soft",
              )}
            >
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminSidebar({ isSuper }: { isSuper: boolean }) {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card lg:block">
      <div className="sticky top-0 flex h-dvh flex-col gap-6 p-4">
        <Link href="/admin/dashboard" className="flex items-center gap-2 px-2 pt-1 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Trophy className="size-4" aria-hidden />
          </span>
          Quiz Admin
        </Link>
        <nav aria-label="Admin">
          <NavLinks isSuper={isSuper} />
        </nav>
      </div>
    </aside>
  );
}

export function AdminMobileNav({ isSuper }: { isSuper: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted"
        aria-label="Open navigation"
        aria-expanded={open}
      >
        <Menu className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" className="flex-1 bg-black/40" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <nav aria-label="Admin" className="order-first h-full w-72 overflow-y-auto border-r bg-card p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">Quiz Admin</span>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-muted" aria-label="Close navigation">
                <X className="size-4" />
              </button>
            </div>
            <NavLinks isSuper={isSuper} onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      )}
    </div>
  );
}
