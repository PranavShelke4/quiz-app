import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserActions } from "@/components/admin/user-actions";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { hasPermission } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/utils";
import { getUserDetail } from "@/services/user.service";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserDetailPage({ params }: PageProps<"/admin/users/[id]">) {
  const auth = await requireAdmin("users:manage");
  const { id } = await params;
  let detail;
  try {
    detail = await getUserDetail(id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const { user: u, competitions, sessions, flags, activeSessions } = detail;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/admin/users" className="hover:underline">Users</Link> / <span className="text-foreground">{u.name}</span>
      </nav>

      <Card>
        <CardContent className="flex flex-col gap-5 pt-5 sm:pt-6 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={u.name} src={u.avatar} className="size-14 text-base" />
            <div>
              <h1 className="text-xl font-semibold">{u.name}</h1>
              <p className="text-sm text-muted-foreground">{u.email}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone={u.isActive ? "success" : "danger"}>{u.isActive ? "Active" : "Disabled"}</Badge>
                <Badge>{u.role}</Badge>
                {u.lockedUntil && <Badge tone="warning">Locked until {formatDateTime(u.lockedUntil)}</Badge>}
              </div>
            </div>
          </div>
          <UserActions
            id={u.id}
            name={u.name}
            isActive={u.isActive}
            role={u.role}
            canManageRoles={hasPermission(auth.user.role, "admins:manage")}
            isSelf={auth.user.id === u.id}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Created</dt><dd>{formatDate(u.createdAt)}</dd>
              <dt className="text-muted-foreground">Last login</dt><dd>{formatDateTime(u.lastLoginAt)}</dd>
              <dt className="text-muted-foreground">Last login IP</dt><dd className="font-mono text-xs">{u.lastLoginIp ?? "—"}</dd>
              <dt className="text-muted-foreground">Active sessions</dt><dd>{activeSessions}</dd>
              <dt className="text-muted-foreground">Failed logins</dt><dd>{u.failedLoginAttempts}</dd>
              {u.disabledReason && (<><dt className="text-muted-foreground">Disabled reason</dt><dd>{u.disabledReason}</dd></>)}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Security metadata is shown for abuse investigation only. Passwords are never stored or displayed.</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Competition history</CardTitle></CardHeader>
          {competitions.length === 0 ? (
            <CardContent><p className="text-sm text-muted-foreground">Hasn&apos;t joined a competition.</p></CardContent>
          ) : (
            <Table>
              <THead>
                <tr><TH>Competition</TH><TH className="text-right">Answered</TH><TH className="text-right">Missed</TH><TH className="text-right">Score</TH><TH className="text-right">Rank</TH><TH /></tr>
              </THead>
              <TBody>
                {competitions.map((c) => (
                  <TR key={c.competitionId}>
                    <TD>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">Joined {formatDate(c.joinedAt)} · streak {c.currentStreak} (best {c.longestStreak})</p>
                    </TD>
                    <TD className="text-right tabular-nums">{c.answered}</TD>
                    <TD className="text-right tabular-nums">{c.missed}</TD>
                    <TD className="text-right tabular-nums">
                      {c.score} <span className="text-xs text-muted-foreground">({c.correct}✓/{c.wrong}✗)</span>
                      {!c.revealed && <span className="block text-[11px] text-warning">confidential · not revealed</span>}
                    </TD>
                    <TD className="text-right tabular-nums">{c.rank ? `#${c.rank}` : "—"}</TD>
                    <TD><ButtonLink href={`/admin/answers?competitionId=${c.competitionId}&user=${encodeURIComponent(u.email)}`} variant="ghost" size="sm">Answers</ButtonLink></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent sessions</CardTitle></CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions.</p>
            ) : (
              <ul className="divide-y text-sm">
                {sessions.map((s, i) => (
                  <li key={i} className="py-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={s.active ? "success" : "neutral"}>{s.active ? "Active" : "Ended"}</Badge>
                      <span className="text-xs">{s.kind}</span>
                      <span className="font-mono text-xs text-muted-foreground">{s.ip ?? "—"}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{formatDateTime(s.createdAt)} · {s.userAgent ?? "unknown agent"}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Anti-cheat flags</CardTitle></CardHeader>
          <CardContent>
            {flags.length === 0 ? (
              <p className="text-sm text-muted-foreground">No flags.</p>
            ) : (
              <ul className="divide-y text-sm">
                {flags.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                    <span>{f.type.replaceAll("_", " ").toLowerCase()} {f.dayNumber ? `· day ${f.dayNumber}` : ""}</span>
                    <Badge tone={f.status === "OPEN" ? "warning" : "neutral"}>{f.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
