"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

export function LeaderboardActions({ competitionId, name, revealed, ended }: { competitionId: string; name: string; revealed: boolean; ended: boolean }) {
  const { fire } = useAction();
  const [dialog, setDialog] = useState<"reveal" | "hide" | null>(null);
  return (
    <>
      {revealed ? (
        <Button variant="outline" size="sm" onClick={() => setDialog("hide")}>
          <EyeOff /> Hide leaderboard
        </Button>
      ) : (
        <Button size="sm" onClick={() => setDialog("reveal")} disabled={!ended} title={ended ? undefined : "Available once the competition ends"}>
          <Eye /> Reveal leaderboard
        </Button>
      )}
      <ConfirmDialog
        open={dialog === "reveal"}
        onClose={() => setDialog(null)}
        tone="primary"
        title="Reveal the final leaderboard?"
        description="All participants will see final ranks, scores, correct answers and explanations. They'll be notified."
        confirmText={name}
        confirmLabel="Reveal leaderboard"
        loadingLabel="Revealing…"
        onConfirm={async () => {
          await fire("reveal", "/api/admin/leaderboard", { body: { competitionId, action: "reveal" } }, "Leaderboard revealed.");
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog === "hide"}
        onClose={() => setDialog(null)}
        title="Hide the leaderboard?"
        description="Participants will see the locked state again. Automatic reveal won't override this."
        confirmLabel="Hide leaderboard"
        loadingLabel="Hiding…"
        onConfirm={async () => {
          await fire("hide", "/api/admin/leaderboard", { body: { competitionId, action: "hide" } }, "Leaderboard hidden.");
          setDialog(null);
        }}
      />
    </>
  );
}
