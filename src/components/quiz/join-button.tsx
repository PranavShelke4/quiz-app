"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiClientError, api } from "@/lib/api/client";

export function JoinButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg"
      disabled={disabled}
      loading={busy}
      loadingText="Joining…"
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/competitions/current/join", { body: {} });
          toast.success("You're in! Good luck.");
          router.refresh();
        } catch (e) {
          toast.error(e instanceof ApiClientError ? e.message : "Couldn't join. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      Join the Competition
    </Button>
  );
}
