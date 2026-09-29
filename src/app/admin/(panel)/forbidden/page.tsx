import { ShieldAlert } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

export default function ForbiddenPage() {
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title="You don't have access to this page"
      description="This area requires super admin permissions."
      action={<ButtonLink href="/admin/dashboard">Back to dashboard</ButtonLink>}
    />
  );
}
