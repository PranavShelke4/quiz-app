"use client";

import { CheckCircle2, Clock, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Countdown } from "@/components/countdown";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/primitives";
import { ApiClientError, api } from "@/lib/api/client";
import type { AntiCheatSettings, AttemptEventType, LockReason } from "@/lib/quiz/anticheat-config";
import { cn } from "@/lib/utils";
import type { UserQuestionDTO } from "@/services/quiz.service";

type OptionId = UserQuestionDTO["options"][number]["id"];

interface Props {
  question: UserQuestionDTO;
  status: "OPEN" | "ANSWERED";
  selectedOptionId?: OptionId;
  selectedOptionIds?: OptionId[];
  submittedAt?: string;
  closesAt: string;
  serverTime: string;
  nextQuestionLabel: string | null;
  canSubmit: boolean;
  blockedReason?: string;
  /** Anti-cheat mode: a running timed attempt. */
  timed?: {
    deadlineAt: string;
    serverTime: string;
    antiCheat: AntiCheatSettings;
    /** Shown faintly across the question (e.g. "Name · email"). */
    watermark: string;
    onEnded: (reason: LockReason | "TIME_UP") => void;
  };
}

/** Sends an integrity signal. `beacon` survives the page being closed or hidden. */
async function reportEvent(type: AttemptEventType, beacon = false): Promise<{ status: string | null; lockReason: LockReason | null } | null> {
  const body = JSON.stringify({ type });
  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/quiz/attempt/event", new Blob([body], { type: "application/json" }));
    return null;
  }
  try {
    const res = await fetch("/api/quiz/attempt/event", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" });
    const json = (await res.json()) as { data?: { status: string | null; lockReason: LockReason | null } };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** Seconds left until the server deadline, corrected for device clock skew. */
function useSecondsLeft(deadlineAt: string | undefined, serverTime: string | undefined) {
  const [skew] = useState(() => (serverTime ? Date.parse(serverTime) - Date.now() : 0));
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadlineAt) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((Date.parse(deadlineAt) - (Date.now() + skew)) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineAt, skew]);
  return left;
}

/**
 * The daily question. After submission it shows only confirmation — never
 * correctness. The server is the source of truth: after submit we refresh
 * server state rather than trusting local state.
 */
export function QuizCard(props: Props) {
  const router = useRouter();
  const groupId = useId();
  const multi = props.question.multiSelect;
  const [selected, setSelected] = useState<OptionId[]>(
    props.selectedOptionIds?.length ? props.selectedOptionIds : props.selectedOptionId ? [props.selectedOptionId] : [],
  );
  const toggle = (id: OptionId) =>
    setSelected((cur) => (multi ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(props.status === "ANSWERED");
  const [error, setError] = useState<string | null>(null);
  const submittedAtRef = useRef(props.submittedAt);
  const [ended, setEnded] = useState(false);
  const locked = submitted || ended || !props.canSubmit;
  const timed = props.timed;
  const secondsLeft = useSecondsLeft(timed?.deadlineAt, timed?.serverTime);
  // Once a submit is in flight or the attempt ended, stop reporting leave events.
  const guardOff = useRef(false);

  const endLocally = (reason: LockReason | "TIME_UP") => {
    if (guardOff.current) return;
    guardOff.current = true;
    setEnded(true);
    timed?.onEnded(reason);
  };

  // Time limit: end the attempt when the server deadline passes.
  useEffect(() => {
    if (timed && secondsLeft === 0 && !submitted) endLocally("TIME_UP");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, submitted]);

  // Leaving the page (other tab/app/window, closing, fullscreen exit) ends the attempt.
  useEffect(() => {
    if (!timed || submitted) return;
    const ac = timed.antiCheat;
    const leave = async (type: AttemptEventType, beacon = false) => {
      if (guardOff.current) return;
      if (ac.lockOnLeave) endLocally(type === "FULLSCREEN_EXIT" ? "FULLSCREEN_EXIT" : "LEFT_PAGE");
      await reportEvent(type, beacon);
    };
    const onVisibility = () => document.visibilityState === "hidden" && void leave("VISIBILITY_HIDDEN");
    const onBlur = () => void leave("WINDOW_BLUR");
    const onPageHide = () => void leave("PAGE_HIDE", true);
    let wasFullscreen = !!document.fullscreenElement;
    const onFullscreen = () => {
      if (document.fullscreenElement) wasFullscreen = true;
      else if (wasFullscreen && ac.requireFullscreen) void leave("FULLSCREEN_EXIT");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, submitted]);

  // Copy / right-click / long-press menu are blocked on the question (and recorded once each).
  const reported = useRef(new Set<AttemptEventType>());
  const onBlocked = (e: React.SyntheticEvent) => {
    if (!timed?.antiCheat.watermark || submitted) return;
    e.preventDefault();
    const type: AttemptEventType = e.type === "contextmenu" ? "CONTEXT_MENU" : "COPY_ATTEMPT";
    if (!reported.current.has(type)) {
      reported.current.add(type);
      void reportEvent(type);
    }
  };

  async function submit() {
    if (!selected.length || submitting || locked) return;
    guardOff.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ submittedAt: string }>("/api/quiz/submit", {
        body: { ...(multi ? { optionIds: selected } : { optionId: selected[0] }), dayNumber: props.question.dayNumber, questionId: props.question.id },
      });
      submittedAtRef.current = res.submittedAt;
      setSubmitted(true);
      toast.success("Answer submitted successfully.");
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiClientError ? e : null;
      if (err?.code === "ANSWER_ALREADY_SUBMITTED") {
        setSubmitted(true);
        router.refresh();
      } else if (timed && (err?.code === "ATTEMPT_LOCKED" || err?.code === "ATTEMPT_OTHER_DEVICE")) {
        guardOff.current = false;
        endLocally("LEFT_PAGE");
      } else if (timed && err?.code === "QUESTION_EXPIRED") {
        guardOff.current = false;
        endLocally("TIME_UP");
      } else if (err?.code === "QUESTION_EXPIRED") {
        setError("Today's question just closed. Loading the next one…");
        router.refresh();
      } else {
        guardOff.current = false;
        setError(err?.message ?? "We couldn't submit your answer. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const q = props.question;

  return (
    <Card
      className={cn("relative overflow-hidden", timed?.antiCheat.watermark && !submitted && "select-none [-webkit-touch-callout:none]")}
      onCopy={onBlocked}
      onCut={onBlocked}
      onContextMenu={onBlocked}
    >
      {timed?.antiCheat.watermark && <Watermark text={timed.watermark} />}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <Badge tone="primary">Question {q.dayNumber}</Badge>
          <Badge>{q.category}</Badge>
          <span className="text-xs text-muted-foreground">
            {q.points} {q.points === 1 ? "point" : "points"}
          </span>
        </div>
        {timed && !submitted && secondsLeft !== null && (
          <span
            role="timer"
            aria-live="off"
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums",
              secondsLeft <= 10 ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary-soft-foreground",
            )}
          >
            <Timer className="size-4" aria-hidden /> {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
          </span>
        )}
        {!timed && !submitted && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden /> Closes in{" "}
            <span className="font-medium text-foreground">
              <Countdown compact target={props.closesAt} serverTime={props.serverTime} onDoneLabel="closed" />
            </span>
          </span>
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="space-y-1.5">
          <h2 id={`${groupId}-q`} className="text-lg font-semibold leading-snug sm:text-xl">
            {q.questionText}
          </h2>
          {multi && <p className="text-sm font-medium text-primary">Select all that apply. Every correct option is needed to score.</p>}
        </div>

        <div role={multi ? "group" : "radiogroup"} aria-labelledby={`${groupId}-q`} aria-disabled={locked || undefined} className="grid gap-2.5">
          {q.options.map((o) => {
            const isSelected = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  !locked && "hover:border-primary/40 hover:bg-muted/50",
                  isSelected && "border-primary bg-primary-soft",
                  locked && "cursor-default",
                  locked && !isSelected && "opacity-60",
                )}
              >
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={groupId}
                  value={o.id}
                  checked={isSelected}
                  disabled={locked}
                  onChange={() => toggle(o.id)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center border text-sm font-semibold",
                    multi ? "rounded-md" : "rounded-lg",
                    isSelected ? "border-primary bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {o.id}
                </span>
                <span className="text-sm sm:text-base">{o.text}</span>
                {submitted && isSelected && <span className="ml-auto text-xs font-medium text-primary-soft-foreground">Your answer</span>}
              </label>
            );
          })}
        </div>

        {error && <Alert tone="danger">{error}</Alert>}
        {!props.canSubmit && !submitted && props.blockedReason && <Alert tone="warning">{props.blockedReason}</Alert>}

        {submitted ? (
          <div role="status" aria-live="polite" className="space-y-2 rounded-xl border border-primary/25 bg-primary-soft p-4 text-primary-soft-foreground">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="size-5" aria-hidden /> Answer submitted
            </p>
            <p className="text-sm text-foreground/80">Your response has been recorded successfully. Results will be revealed when the competition ends.</p>
            {props.nextQuestionLabel && <p className="text-sm text-foreground/80">Next question available: {props.nextQuestionLabel}</p>}
          </div>
        ) : (
          // Sticky on mobile so the primary action is always reachable.
          <div className="sticky bottom-0 -mx-5 border-t bg-card/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <Button size="lg" className="w-full sm:w-auto" onClick={submit} disabled={!selected.length || locked} loading={submitting} loadingText="Submitting…">
              Submit Answer
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">You can submit only once. Answers can&apos;t be changed.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Faint, repeated identity text: any leaked screenshot shows whose screen it was. */
function Watermark({ text }: { text: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none">
      <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-start gap-x-10 gap-y-12 opacity-[0.07]">
        {Array.from({ length: 60 }, (_, i) => (
          <span key={i} className="whitespace-nowrap text-sm font-semibold text-foreground">
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
