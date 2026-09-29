"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export function LogoutButton({ redirectTo = "/login", className, compact }: { redirectTo?: string; className?: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      className={cn(className)}
      loading={busy}
      aria-label="Sign out"
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/auth/logout", { method: "POST", body: {} });
          router.replace(redirectTo);
          router.refresh();
        } catch {
          toast.error("Couldn't sign out. Please try again.");
          setBusy(false);
        }
      }}
    >
      <LogOut aria-hidden />
      {!compact && "Sign out"}
    </Button>
  );
}
