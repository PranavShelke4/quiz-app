"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Countdown } from "@/components/countdown";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/primitives";
import { ApiClientError, api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { UserQuestionDTO } from "@/services/quiz.service";

type OptionId = UserQuestionDTO["options"][number]["id"];

interface Props {
  question: UserQuestionDTO;
  status: "OPEN" | "ANSWERED";
  selectedOptionId?: OptionId;
  submittedAt?: string;
  closesAt: string;
  serverTime: string;
  nextQuestionLabel: string | null;
  canSubmit: boolean;
  blockedReason?: string;
}

/**
 * The daily question. After submission it shows only confirmation — never
 * correctness. The server is the source of truth: after submit we refresh
 * server state rather than trusting local state.
 */
export function QuizCard(props: Props) {
  const router = useRouter();
  const groupId = useId();
  const [selected, setSelected] = useState<OptionId | null>(props.selectedOptionId ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(props.status === "ANSWERED");
  const [error, setError] = useState<string | null>(null);
  const submittedAtRef = useRef(props.submittedAt);
  const locked = submitted || !props.canSubmit;

  async function submit() {
    if (!selected || submitting || locked) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ submittedAt: string }>("/api/quiz/submit", {
        body: { optionId: selected, dayNumber: props.question.dayNumber, questionId: props.question.id },
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
      } else if (err?.code === "QUESTION_EXPIRED") {
        setError("Today's question just closed. Loading the next one…");
        router.refresh();
      } else {
        setError(err?.message ?? "We couldn't submit your answer. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const q = props.question;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <Badge tone="primary">Question {q.dayNumber}</Badge>
          <Badge>{q.category}</Badge>
          <span className="text-xs text-muted-foreground">
            {q.points} {q.points === 1 ? "point" : "points"}
          </span>
        </div>
        {!submitted && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden /> Closes in{" "}
            <span className="font-medium text-foreground">
              <Countdown compact target={props.closesAt} serverTime={props.serverTime} onDoneLabel="closed" />
            </span>
          </span>
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <h2 id={`${groupId}-q`} className="text-lg font-semibold leading-snug sm:text-xl">
          {q.questionText}
        </h2>

        <div role="radiogroup" aria-labelledby={`${groupId}-q`} aria-disabled={locked || undefined} className="grid gap-2.5">
          {q.options.map((o) => {
            const isSelected = selected === o.id;
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
                  type="radio"
                  name={groupId}
                  value={o.id}
                  checked={isSelected}
                  disabled={locked}
                  onChange={() => setSelected(o.id)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold",
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
            <Button size="lg" className="w-full sm:w-auto" onClick={submit} disabled={!selected || locked} loading={submitting} loadingText="Submitting…">
              Submit Answer
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">You can submit only once. Answers can&apos;t be changed.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
