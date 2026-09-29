import type { Metadata } from "next";
import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth/dal";
import { getSettings } from "@/services/settings.service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await requireAdmin("settings:view");
  const settings = await getSettings({ fresh: true });
  return (
    <>
      <PageHeader title="Settings" description="Platform-wide configuration. Every change is recorded in the audit log." />
      <SettingsForm initial={settings} isSuper={auth.user.role === "SUPER_ADMIN"} />
    </>
  );
}
