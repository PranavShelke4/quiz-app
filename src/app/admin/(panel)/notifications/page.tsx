import type { Metadata } from "next";
import { PushBroadcast } from "@/components/admin/push-broadcast";
import { PageHeader, StatCard } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth/dal";
import { pushStats } from "@/services/push.service";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireAdmin("notifications:send");
  const stats = await pushStats();
  const pct = stats.totalUsers ? Math.round((stats.users / stats.totalUsers) * 100) : 0;
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Push notifications reach participants' phones and computers even when the site is closed. People who haven't turned them on are reminded every 3 days."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="People with notifications on" value={`${stats.users} / ${stats.totalUsers}`} />
        <StatCard label="Opted in" value={`${pct}%`} />
        <StatCard label="Devices" value={stats.devices} />
      </div>
      <PushBroadcast subscribers={stats.users} configured={stats.configured} />
    </>
  );
}
