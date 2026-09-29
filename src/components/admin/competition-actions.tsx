"use client";

import { Archive, Calculator, EyeOff, Rocket, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useAction } from "@/components/admin/use-action";

type Kind = "publish" | "unpublish" | "archive" | "recalculate" | "finalize" | "delete";

export function CompetitionActions({
  id,
  name,
  status,
  phase,
  ready,
}: {
  id: string;
  name: string;
  status: string;
  phase: string;
  ready: boolean;
}) {
  const router = useRouter();
  const { pending, fire, run } = useAction();
  const [confirm, setConfirm] = useState<Kind | null>(null);

  const act = (action: Exclude<Kind, "delete">, msg: string) => fire(action, `/api/admin/competitions/${id}/actions`, { body: { action } }, msg);

  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && (
        <Button size="sm" onClick={() => setConfirm("publish")} disabled={!ready} title={ready ? undefined : "Every day needs a published question"}>
          <Rocket /> Publish
        </Button>
      )}
      {status === "SCHEDULED" && phase === "NOT_STARTED" && (
        <Button size="sm" variant="outline" onClick={() => act("unpublish", "Moved back to draft.")} loading={pending === "unpublish"}>
          <Undo2 /> Unpublish
        </Button>
      )}
      {phase !== "NOT_STARTED" && (
        <Button size="sm" variant="outline" onClick={() => setConfirm("recalculate")} loading={pending === "recalculate"}>
          <Calculator /> Recalculate stats
        </Button>
      )}
      {phase === "ENDED" && (
        <Button size="sm" variant="outline" onClick={() => act("finalize", "Final ranks recalculated.")} loading={pending === "finalize"}>
          <EyeOff /> Re-finalize ranks
        </Button>
      )}
      {status === "COMPLETED" && (
        <Button size="sm" variant="outline" onClick={() => setConfirm("archive")}>
          <Archive /> Archive
        </Button>
      )}
      {status === "DRAFT" && (
        <Button size="sm" variant="danger" onClick={() => setConfirm("delete")}>
          <Trash2 /> Delete
        </Button>
      )}

      <ConfirmDialog
        open={confirm === "publish"}
        onClose={() => setConfirm(null)}
        tone="primary"
        title="Publish competition?"
        description="Participants will see it and can register. Dates and scoring lock once Day 1 starts."
        confirmLabel="Publish"
        loadingLabel="Publishing…"
        onConfirm={async () => {
          await act("publish", "Competition published.");
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "recalculate"}
        onClose={() => setConfirm(null)}
        tone="primary"
        title="Recalculate participant statistics?"
        description="Rebuilds every participant's totals and streaks from the stored answer records. Safe to run at any time."
        confirmLabel="Recalculate"
        loadingLabel="Recalculating…"
        onConfirm={async () => {
          await act("recalculate", "Statistics rebuilt from answer records.");
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        onClose={() => setConfirm(null)}
        title="Archive competition?"
        description="Archived competitions become read-only and are hidden from participants."
        confirmLabel="Archive"
        loadingLabel="Archiving…"
        onConfirm={async () => {
          await act("archive", "Competition archived.");
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title="Delete competition?"
        description="This deletes the draft and all its questions. This action cannot be easily undone."
        confirmText={name}
        confirmLabel="Delete competition"
        loadingLabel="Deleting…"
        onConfirm={async () => {
          try {
            await run("delete", `/api/admin/competitions/${id}`, { method: "DELETE", body: { confirmName: name } }, "Competition deleted.");
            setConfirm(null);
            router.push("/admin/competitions");
          } catch {
            /* toasted */
          }
        }}
      />
    </div>
  );
}
