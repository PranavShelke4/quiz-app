"use client";

import { Ban, Copy, EyeOff, Maximize, Play, ShieldAlert, Shuffle, Timer, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { QuizCard } from "@/components/quiz/quiz-card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/primitives";
import { ApiClientError, api } from "@/lib/api/client";
import { LOCK_REASON_LABELS, type AntiCheatSettings, type LockReason } from "@/lib/quiz/anticheat-config";
import type { ReadyInfo, UserQuestionDTO } from "@/services/quiz.service";

interface Started {
  question: UserQuestionDTO;
  deadlineAt: string;
  serverTime: string;
}

type Props =
  | { mode: "READY"; info: ReadyInfo; antiCheat: AntiCheatSettings; dayNumber: number; closesAt: string; watermark: string; nextQuestionLabel: string | null }
  | { mode: "IN_PROGRESS"; started: Started; antiCheat: AntiCheatSettings; watermark: string; closesAt: string; nextQuestionLabel: string | null }
  | { mode: "ENDED"; reason: LockReason | "TIME_UP"; nextQuestionLabel: string | null };

/** Requests fullscreen where the browser allows it (not on iPhone). Never throws. */
async function tryFullscreen(): Promise<boolean> {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export function TimedQuiz(props: Props) {
  const [started, setStarted] = useState<Started | null>(props.mode === "IN_PROGRESS" ? props.started : null);
  const [endedReason, setEndedReason] = useState<LockReason | "TIME_UP" | null>(props.mode === "ENDED" ? props.reason : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (endedReason) return <EndedCard reason={endedReason} nextQuestionLabel={props.nextQuestionLabel} />;

  if (props.mode === "ENDED") return null; // unreachable: handled above
  const { antiCheat: ac, watermark } = props;

  if (started) {
    return (
      <QuizCard
        key={started.question.id}
        question={started.question}
        status="OPEN"
        closesAt={props.closesAt}
        serverTime={started.serverTime}
        nextQuestionLabel={props.nextQuestionLabel}
        canSubmit
        timed={{
          deadlineAt: started.deadlineAt,
          serverTime: started.serverTime,
          antiCheat: ac,
          watermark,
          onEnded: (reason) => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            setEndedReason(reason);
          },
        }}
      />
    );
  }

  if (props.mode !== "READY") return null;
  const info = props.info;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      if (ac.requireFullscreen) await tryFullscreen(); // best effort; unsupported phones just continue
      const res = await api<Started>("/api/quiz/attempt/start", { body: {} });
      setStarted(res);
    } catch (e) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      const err = e instanceof ApiClientError ? e : null;
      if (err?.code === "ATTEMPT_LOCKED" || err?.code === "ATTEMPT_OTHER_DEVICE") setEndedReason("SECOND_DEVICE");
      else setError(err?.message ?? "Couldn't start the question. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const rules: { icon: ReactNode; text: string }[] = [
    { icon: <Timer />, text: `You'll have ${formatSeconds(ac.timeLimitSeconds)} to answer once you press Start.` },
    ...(ac.lockOnLeave
      ? [{ icon: <EyeOff />, text: "Stay on this screen. Switching apps or tabs, locking your phone, reloading, or opening the quiz on another device ends your attempt (recorded as missed)." }]
      : []),
    ...(ac.shuffleOptions ? [{ icon: <Shuffle />, text: "Options are shuffled for every participant." }] : []),
    ...(ac.watermark ? [{ icon: <Copy />, text: "Copying is disabled and the question is watermarked with your name." }] : []),
    ...(ac.requireFullscreen ? [{ icon: <Maximize />, text: "The quiz opens fullscreen where your browser supports it — don't exit it." }] : []),
    { icon: <Ban />, text: "Turn on Do Not Disturb so calls or notifications don't interrupt you." },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 sm:px-6">
        <Badge tone="primary">Question {props.dayNumber}</Badge>
        <Badge>{info.category}</Badge>
        <span className="text-xs text-muted-foreground">
          {info.points} {info.points === 1 ? "point" : "points"} · {info.optionCount} options{info.multiSelect ? " · select all that apply" : ""}
        </span>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold sm:text-xl">
            <ShieldAlert className="size-5 text-primary" aria-hidden /> Before you start
          </h2>
          <p className="text-sm text-muted-foreground">The question stays hidden until you press Start. You get one attempt.</p>
        </div>
        <ul className="space-y-3">
          {rules.map((r) => (
            <li key={r.text} className="flex gap-3 text-sm leading-relaxed">
              <span className="mt-0.5 shrink-0 text-primary [&>svg]:size-4" aria-hidden>{r.icon}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button size="lg" className="h-14 w-full text-base" onClick={start} loading={busy} loadingText="Starting…">
          <Play /> Start — {formatSeconds(ac.timeLimitSeconds)}
        </Button>
      </div>
    </Card>
  );
}

function EndedCard({ reason, nextQuestionLabel }: { reason: LockReason | "TIME_UP"; nextQuestionLabel: string | null }) {
  return (
    <Card className="space-y-3 p-6 text-center sm:p-8">
      <XCircle className="mx-auto size-12 text-danger" aria-hidden />
      <h2 className="text-xl font-semibold">Today&apos;s attempt has ended</h2>
      <p className="text-muted-foreground">{LOCK_REASON_LABELS[reason]}</p>
      <p className="text-sm text-muted-foreground">This day is recorded as missed (0 points).</p>
      {nextQuestionLabel && <p className="text-sm text-muted-foreground">Next question: {nextQuestionLabel}</p>}
    </Card>
  );
}

function formatSeconds(total: number): string {
  if (total < 60) return `${total} seconds`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m} min ${s} s` : `${m} minute${m === 1 ? "" : "s"}`;
}
