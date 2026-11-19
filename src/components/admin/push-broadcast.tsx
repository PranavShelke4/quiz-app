"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Textarea } from "@/components/ui/primitives";
import { ApiClientError } from "@/lib/api/client";

interface Result {
  devices: number;
  users: number;
  sent: number;
  failed: number;
  removed: number;
}

/** Compose and send a push notification to everyone who turned notifications on. */
export function PushBroadcast({ subscribers, configured }: { subscribers: number; configured: boolean }) {
  const { run } = useAction();
  const [title, setTitle] = useState("Today's question is live");
  const [body, setBody] = useState("Answer before it closes to keep your streak going.");
  const [url, setUrl] = useState("/quiz");
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<Result | null>(null);

  async function send() {
    setErrors({});
    try {
      const res = await run<Result>("push", "/api/admin/push", { body: { title, body, url } });
      if (res) setResult(res);
    } catch (e) {
      if (e instanceof ApiClientError) setErrors(e.fieldErrors);
    } finally {
      setConfirm(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a notification</CardTitle>
        <CardDescription>Goes to every device where a participant turned notifications on ({subscribers} people right now).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured && <Alert tone="warning">Push isn&apos;t configured on the server yet (VAPID keys missing), so nothing can be sent.</Alert>}
        <Field id="push-title" label="Title" error={errors.title} hint={`${title.length}/80`}>
          <Input id="push-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id="push-body" label="Message" error={errors.body} hint={`${body.length}/240`}>
          <Textarea id="push-body" value={body} maxLength={240} rows={3} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field id="push-url" label="Opens when tapped" error={errors.url} hint="A page on this site, e.g. /quiz or /leaderboard">
          <Input id="push-url" value={url} maxLength={200} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setConfirm(true)} disabled={!configured || subscribers === 0 || !title.trim() || !body.trim()}>
            <Send /> Send to {subscribers} {subscribers === 1 ? "person" : "people"}
          </Button>
          {result && (
            <p className="text-sm text-muted-foreground">
              Sent to {result.sent} of {result.devices} devices ({result.users} people).
              {result.removed > 0 && ` Removed ${result.removed} expired.`}
              {result.failed - result.removed > 0 && ` ${result.failed - result.removed} failed.`}
            </p>
          )}
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={send}
        tone="primary"
        title={`Send to ${subscribers} ${subscribers === 1 ? "person" : "people"}?`}
        description={
          <>
            <strong>{title}</strong> — {body}
          </>
        }
        confirmLabel="Send now"
        loadingLabel="Sending…"
      />
    </Card>
  );
}
