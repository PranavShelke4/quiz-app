"use client";

import { useState } from "react";
import { useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/primitives";

export function FlagReview({ id }: { id: string }) {
  const { fire, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const decide = async (status: "DISMISSED" | "CONFIRMED") => {
    await fire(status, "/api/admin/flags", { body: { id, status, note } }, status === "CONFIRMED" ? "Flag confirmed." : "Flag dismissed.");
    setOpen(false);
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Review</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Review flag"
        description="Confirming records your decision only — it doesn't disable the account or change scores. Use the user page for any follow-up action."
        footer={
          <>
            <Button variant="outline" onClick={() => decide("DISMISSED")} loading={pending === "DISMISSED"}>Dismiss</Button>
            <Button variant="danger" onClick={() => decide("CONFIRMED")} loading={pending === "CONFIRMED"}>Confirm suspicious</Button>
          </>
        }
      >
        <Field id={`note-${id}`} label="Review note">
          <Textarea id={`note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </Dialog>
    </>
  );
}
