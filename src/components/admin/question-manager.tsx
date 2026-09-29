"use client";

import { ArrowDown, ArrowUp, Copy, Download, Eye, FileQuestion, Lock, Pencil, Plus, Rocket, Trash2, Upload, Wrench } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/admin/use-action";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Alert, Badge, Card, Checkbox, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ApiClientError, api } from "@/lib/api/client";
import { toCsv } from "@/lib/csv";
import type { AdminQuestionDTO } from "@/services/question.service";

type OptionId = "A" | "B" | "C" | "D";
const IDS: OptionId[] = ["A", "B", "C", "D"];

interface CompInfo {
  id: string;
  name: string;
  status: string;
  durationDays: number;
  /** Days <= this have opened and are locked (only corrections allowed). */
  lockedThroughDay: number;
  pointsPerCorrectAnswer: number;
}

type Draft = {
  dayNumber: number;
  questionText: string;
  options: { id: OptionId; text: string }[];
  correctOptionId: OptionId;
  explanation: string;
  category: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  points: number | null;
  status: "DRAFT" | "PUBLISHED";
};

function emptyDraft(day: number): Draft {
  return {
    dayNumber: day,
    questionText: "",
    options: IDS.map((id) => ({ id, text: "" })),
    correctOptionId: "A",
    explanation: "",
    category: "General",
    difficulty: "MEDIUM",
    points: null,
    status: "DRAFT",
  };
}

export function QuestionManager({ comp, questions }: { comp: CompInfo; questions: AdminQuestionDTO[] }) {
  const params = useSearchParams();
  const { pending, fire } = useAction();
  const byDay = new Map(questions.map((q) => [q.dayNumber, q]));
  const freeDays = Array.from({ length: comp.durationDays }, (_, i) => i + 1).filter((d) => !byDay.has(d) && d > comp.lockedThroughDay);
  // Deep links from the dashboard quick actions (?new=1 / ?import=1) seed the initial state.
  const [editor, setEditor] = useState<{ id?: string; draft: Draft } | null>(() =>
    params.get("new") === "1" && freeDays[0] ? { draft: emptyDraft(freeDays[0]) } : null,
  );
  const [preview, setPreview] = useState<AdminQuestionDTO | null>(null);
  const [toDelete, setToDelete] = useState<AdminQuestionDTO | null>(null);
  const [correcting, setCorrecting] = useState<AdminQuestionDTO | null>(null);
  const [importOpen, setImportOpen] = useState(() => params.get("import") === "1");
  const [dupFor, setDupFor] = useState<AdminQuestionDTO | null>(null);

  const readOnly = comp.status === "COMPLETED" || comp.status === "ARCHIVED";
  const isLocked = (day: number) => readOnly || day <= comp.lockedThroughDay;
  const drafts = questions.filter((q) => q.status === "DRAFT" && !isLocked(q.dayNumber)).length;

  const swap = (a: AdminQuestionDTO, b: AdminQuestionDTO | undefined) => {
    if (!b) return toast.error("Both days need a question to swap. Edit the day number instead.");
    return fire(`swap-${a.id}`, `/api/admin/questions/${a.id}`, { body: { action: "swap", otherQuestionId: b.id } }, `Swapped day ${a.dayNumber} and day ${b.dayNumber}.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {questions.length} of {comp.durationDays} days have a question · {questions.filter((q) => q.status === "PUBLISHED").length} published
        </p>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {drafts > 0 && (
              <Button variant="outline" size="sm" loading={pending === "publish-all"} onClick={() => fire("publish-all", "/api/admin/questions/publish-all", { body: { competitionId: comp.id } }, "Draft questions published.")}>
                <Rocket /> Publish {drafts} draft{drafts === 1 ? "" : "s"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload /> Import CSV
            </Button>
            <Button size="sm" disabled={!freeDays.length} onClick={() => setEditor({ draft: emptyDraft(freeDays[0]!) })}>
              <Plus /> Add question
            </Button>
          </div>
        )}
      </div>

      {questions.length === 0 ? (
        <EmptyState
          icon={<FileQuestion />}
          title="No questions added yet."
          description="Add your first question or import questions using CSV."
          action={
            !readOnly && (
              <div className="flex gap-2">
                <Button onClick={() => setEditor({ draft: emptyDraft(1) })}><Plus /> Add question</Button>
                <Button variant="outline" onClick={() => setImportOpen(true)}><Upload /> Import CSV</Button>
              </div>
            )
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH className="w-16">Day</TH>
                <TH>Question</TH>
                <TH className="hidden md:table-cell">Category</TH>
                <TH className="hidden md:table-cell">Difficulty</TH>
                <TH className="hidden sm:table-cell">Answer</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {Array.from({ length: comp.durationDays }, (_, i) => i + 1).map((day) => {
                const q = byDay.get(day);
                if (!q) {
                  return (
                    <TR key={`empty-${day}`}>
                      <TD className="tabular-nums text-muted-foreground">{day}</TD>
                      <TD colSpan={5} className="text-sm text-muted-foreground">
                        {isLocked(day) ? "No question (day has passed)" : "No question yet"}
                      </TD>
                      <TD className="text-right">
                        {!isLocked(day) && (
                          <Button size="sm" variant="ghost" onClick={() => setEditor({ draft: emptyDraft(day) })}>
                            <Plus /> Add
                          </Button>
                        )}
                      </TD>
                    </TR>
                  );
                }
                const locked = isLocked(day);
                return (
                  <TR key={q.id}>
                    <TD className="tabular-nums font-medium">{day}</TD>
                    <TD className="max-w-md">
                      <p className="line-clamp-2 text-sm">{q.questionText}</p>
                    </TD>
                    <TD className="hidden md:table-cell"><Badge>{q.category}</Badge></TD>
                    <TD className="hidden text-xs md:table-cell">{q.difficulty}</TD>
                    <TD className="hidden font-mono text-xs sm:table-cell">{q.correctOptionId}</TD>
                    <TD>
                      <div className="flex items-center gap-1">
                        <Badge tone={q.status === "PUBLISHED" ? "success" : "warning"}>{q.status}</Badge>
                        {locked && <Lock className="size-3.5 text-muted-foreground" aria-label="Locked" />}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" aria-label={`Preview day ${day}`} onClick={() => setPreview(q)}><Eye /></Button>
                        {locked ? (
                          !readOnly || comp.status === "COMPLETED" ? (
                            <Button variant="ghost" size="icon" aria-label={`Issue correction for day ${day}`} title="Issue correction" onClick={() => setCorrecting(q)}><Wrench /></Button>
                          ) : null
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" aria-label={`Move day ${day} earlier`} disabled={day === 1 || isLocked(day - 1)} onClick={() => swap(q, byDay.get(day - 1))}><ArrowUp /></Button>
                            <Button variant="ghost" size="icon" aria-label={`Move day ${day} later`} disabled={day === comp.durationDays} onClick={() => swap(q, byDay.get(day + 1))}><ArrowDown /></Button>
                            <Button variant="ghost" size="icon" aria-label={`Edit day ${day}`} onClick={() => setEditor({ id: q.id, draft: { ...q, options: q.options as Draft["options"], correctOptionId: q.correctOptionId as OptionId, difficulty: q.difficulty as Draft["difficulty"], status: q.status as Draft["status"] } })}><Pencil /></Button>
                            {q.status === "DRAFT" ? (
                              <Button variant="ghost" size="icon" aria-label={`Publish day ${day}`} title="Publish" onClick={() => fire(`pub-${q.id}`, `/api/admin/questions/${q.id}`, { body: { action: "publish" } }, "Question published.")}><Rocket /></Button>
                            ) : (
                              comp.status === "DRAFT" && (
                                <Button variant="ghost" size="sm" onClick={() => fire(`unpub-${q.id}`, `/api/admin/questions/${q.id}`, { body: { action: "unpublish" } }, "Question unpublished.")}>Unpublish</Button>
                              )
                            )}
                            {comp.status === "DRAFT" && (
                              <Button variant="ghost" size="icon" aria-label={`Delete day ${day}`} onClick={() => setToDelete(q)}><Trash2 /></Button>
                            )}
                          </>
                        )}
                        {!readOnly && freeDays.length > 0 && (
                          <Button variant="ghost" size="icon" aria-label={`Duplicate day ${day}`} title="Duplicate" onClick={() => setDupFor(q)}><Copy /></Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}

      {editor && <QuestionEditor comp={comp} editor={editor} freeDays={freeDays} onClose={() => setEditor(null)} />}

      <Dialog open={!!preview} onClose={() => setPreview(null)} title={`Preview — Day ${preview?.dayNumber}`} description="Exactly what participants see. The correct answer and explanation are hidden.">
        {preview && (
          <div className="space-y-4">
            <p className="text-lg font-semibold">{preview.questionText}</p>
            <div className="grid gap-2">
              {preview.options.map((o) => (
                <div key={o.id} className="flex items-center gap-3 rounded-xl border px-4 py-3">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-sm font-semibold">{o.id}</span>
                  <span className="text-sm">{o.text}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{preview.points ?? comp.pointsPerCorrectAnswer} point(s) · {preview.category}</p>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Delete the day ${toDelete?.dayNumber} question?`}
        description="This action cannot be easily undone."
        confirmLabel="Delete question"
        loadingLabel="Deleting…"
        onConfirm={async () => {
          if (!toDelete) return;
          await fire(`del-${toDelete.id}`, `/api/admin/questions/${toDelete.id}`, { method: "DELETE" }, "Question deleted.");
          setToDelete(null);
        }}
      />

      {correcting && <CorrectionDialog q={correcting} onClose={() => setCorrecting(null)} />}
      {importOpen && <ImportDialog comp={comp} onClose={() => setImportOpen(false)} />}
      {dupFor && <DuplicateDialog q={dupFor} freeDays={freeDays} onClose={() => setDupFor(null)} />}
    </div>
  );
}

function QuestionEditor({ comp, editor, freeDays, onClose }: { comp: CompInfo; editor: { id?: string; draft: Draft }; freeDays: number[]; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(editor.draft);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const days = editor.id ? [...new Set([editor.draft.dayNumber, ...freeDays])].sort((a, b) => a - b) : freeDays;

  async function save() {
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      if (editor.id) {
        const { status: _status, ...rest } = d;
        void _status;
        await api(`/api/admin/questions/${editor.id}`, { method: "PATCH", body: rest });
      } else {
        await api("/api/admin/questions", { body: { ...d, competitionId: comp.id } });
      }
      toast.success(editor.id ? "Question saved." : "Question created.");
      router.refresh();
      onClose();
    } catch (e) {
      if (e instanceof ApiClientError) {
        setErrors(e.fieldErrors);
        setFormError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      side="right"
      onClose={onClose}
      title={editor.id ? `Edit question — Day ${editor.draft.dayNumber}` : "New question"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy} loadingText="Saving…">{editor.id ? "Save question" : "Create question"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="q-day" label="Day" error={errors.dayNumber}>
            <Select id="q-day" value={d.dayNumber} onChange={(e) => setD({ ...d, dayNumber: Number(e.target.value) })}>
              {days.map((n) => <option key={n} value={n}>Day {n}</option>)}
            </Select>
          </Field>
          <Field id="q-diff" label="Difficulty">
            <Select id="q-diff" value={d.difficulty} onChange={(e) => setD({ ...d, difficulty: e.target.value as Draft["difficulty"] })}>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </Select>
          </Field>
          <Field id="q-points" label="Points" hint={`Blank = default (${comp.pointsPerCorrectAnswer})`} error={errors.points}>
            <Input id="q-points" type="number" min={0} max={100} value={d.points ?? ""} onChange={(e) => setD({ ...d, points: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
        </div>
        <Field id="q-text" label="Question" error={errors.questionText}>
          <Textarea id="q-text" value={d.questionText} onChange={(e) => setD({ ...d, questionText: e.target.value })} maxLength={1000} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Options — select the correct one</legend>
          {errors.options && <p className="text-xs text-danger">{errors.options[0]}</p>}
          {d.options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="radio" name="correct" checked={d.correctOptionId === o.id} onChange={() => setD({ ...d, correctOptionId: o.id })} className="size-4 accent-[var(--primary)]" aria-label={`Option ${o.id} is correct`} />
                {o.id}
              </label>
              <Input aria-label={`Option ${o.id} text`} value={o.text} maxLength={300} onChange={(e) => setD({ ...d, options: d.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
            </div>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="q-cat" label="Category" error={errors.category}>
            <Input id="q-cat" value={d.category} maxLength={60} onChange={(e) => setD({ ...d, category: e.target.value })} />
          </Field>
          {!editor.id && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Status</span>
              <label className="flex h-10 items-center gap-2 text-sm">
                <Checkbox checked={d.status === "PUBLISHED"} onChange={(e) => setD({ ...d, status: e.target.checked ? "PUBLISHED" : "DRAFT" })} /> Publish immediately
              </label>
            </div>
          )}
        </div>
        <Field id="q-exp" label="Explanation" hint="Shown to participants only after results are revealed.">
          <Textarea id="q-exp" value={d.explanation} maxLength={2000} onChange={(e) => setD({ ...d, explanation: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

function CorrectionDialog({ q, onClose }: { q: AdminQuestionDTO; onClose: () => void }) {
  const { run } = useAction();
  const [correct, setCorrect] = useState(q.correctOptionId as OptionId);
  const [points, setPoints] = useState<string>(q.points === null ? "" : String(q.points));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const newPoints = points === "" ? null : Number(points);
  const changed = correct !== q.correctOptionId || newPoints !== q.points;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Issue correction — Day ${q.dayNumber}`}
      description="Changes the answer key for everyone and recalculates every affected score. Recorded in the audit log."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!changed || reason.trim().length < 10}
            loading={busy}
            loadingText="Recalculating…"
            onClick={async () => {
              setBusy(true);
              try {
                const res = await run<{ affectedAnswers: number }>("correct", `/api/admin/questions/${q.id}/correction`, {
                  body: { reason, ...(correct !== q.correctOptionId ? { newCorrectOptionId: correct } : {}), ...(newPoints !== q.points ? { newPoints } : {}) },
                });
                toast.success(`Correction applied. ${res?.affectedAnswers ?? 0} answers recalculated.`);
                onClose();
              } catch {
                /* toasted */
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply correction
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-medium">{q.questionText}</p>
        <Field id="c-correct" label={`Correct option (currently ${q.correctOptionId})`}>
          <Select id="c-correct" value={correct} onChange={(e) => setCorrect(e.target.value as OptionId)}>
            {q.options.map((o) => <option key={o.id} value={o.id}>{o.id}. {o.text}</option>)}
          </Select>
        </Field>
        <Field id="c-points" label={`Points (currently ${q.points ?? "default"})`} hint="Blank = competition default">
          <Input id="c-points" type="number" min={0} max={100} value={points} onChange={(e) => setPoints(e.target.value)} />
        </Field>
        <Field id="c-reason" label="Reason (required)" hint="At least 10 characters. Kept permanently.">
          <Textarea id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
      </div>
    </Dialog>
  );
}

function DuplicateDialog({ q, freeDays, onClose }: { q: AdminQuestionDTO; freeDays: number[]; onClose: () => void }) {
  const { fire, pending } = useAction();
  const [day, setDay] = useState(freeDays[0] ?? 1);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Duplicate question"
      description="Creates a draft copy on another day."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={pending === "dup"} loadingText="Creating…" onClick={async () => {
            const r = await fire("dup", `/api/admin/questions/${q.id}`, { body: { action: "duplicate", dayNumber: day } }, `Copied to day ${day}.`);
            if (r) onClose();
          }}>
            Duplicate
          </Button>
        </>
      }
    >
      <Field id="dup-day" label="Target day">
        <Select id="dup-day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
          {freeDays.map((n) => <option key={n} value={n}>Day {n}</option>)}
        </Select>
      </Field>
    </Dialog>
  );
}

interface ImportReport {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: { row: number; dayNumber: string; errors: string[] }[];
  imported: number;
}

const TEMPLATE = "dayNumber,question,optionA,optionB,optionC,optionD,correctOption,category,difficulty,points,explanation\n1,What is the capital of France?,Paris,Rome,Berlin,Madrid,A,Geography,EASY,1,Paris has been France's capital since 508 AD.\n";

function ImportDialog({ comp, onClose }: { comp: CompInfo; onClose: () => void }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [opts, setOpts] = useState({ publish: false, overwrite: false, skipInvalid: false });
  const [busy, setBusy] = useState<"validate" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(dryRun: boolean) {
    setBusy(dryRun ? "validate" : "import");
    setError(null);
    try {
      const r = await api<ImportReport>("/api/admin/questions/import", { body: { competitionId: comp.id, csv, dryRun, ...opts } });
      setReport(r);
      if (!dryRun) {
        toast.success(`${r.imported} question${r.imported === 1 ? "" : "s"} imported.`);
        router.refresh();
        onClose();
      }
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
        if (e.code === "IMPORT_INVALID") setReport(e.details as ImportReport);
      }
    } finally {
      setBusy(null);
    }
  }

  function download(name: string, content: string) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const canImport = report && report.validRows > 0 && (report.errorRows === 0 || opts.skipInvalid);

  return (
    <Dialog
      open
      side="right"
      onClose={onClose}
      title="Import questions from CSV"
      description={`Into ${comp.name}. The whole file is validated first; nothing is imported unless every row is valid (unless you opt in to skipping invalid rows).`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={() => send(true)} disabled={!csv.trim()} loading={busy === "validate"} loadingText="Validating…">Validate</Button>
          <Button onClick={() => send(false)} disabled={!canImport} loading={busy === "import"} loadingText="Importing…">
            Import {report ? (opts.skipInvalid ? report.validRows : report.totalRows) : ""} rows
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
            <Upload className="size-4" aria-hidden /> Choose file
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1_400_000) return toast.error("File is too large (max ~1.4 MB).");
                setCsv(await f.text());
                setReport(null);
              }}
            />
          </label>
          <Button variant="ghost" size="sm" onClick={() => download("questions-template.csv", TEMPLATE)}><Download /> Template</Button>
        </div>
        <Field id="csv" label="CSV content" hint="Columns: dayNumber, question, optionA–D, correctOption (A–D), category, difficulty (EASY/MEDIUM/HARD), points, explanation (optional)">
          <Textarea id="csv" value={csv} onChange={(e) => { setCsv(e.target.value); setReport(null); }} className="min-h-40 font-mono text-xs" />
        </Field>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={opts.publish} onChange={(e) => setOpts({ ...opts, publish: e.target.checked })} /> Publish imported questions</label>
          <label className="flex items-center gap-2"><Checkbox checked={opts.overwrite} onChange={(e) => { setOpts({ ...opts, overwrite: e.target.checked }); setReport(null); }} /> Overwrite existing questions on the same days (upcoming days only)</label>
          <label className="flex items-center gap-2"><Checkbox checked={opts.skipInvalid} onChange={(e) => setOpts({ ...opts, skipInvalid: e.target.checked })} /> Import valid rows even if some rows have errors</label>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {report && (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span><strong>{report.totalRows}</strong> rows detected</span>
              <span className="text-success"><strong>{report.validRows}</strong> valid</span>
              <span className={report.errorRows ? "text-danger" : ""}><strong>{report.errorRows}</strong> errors</span>
            </div>
            {report.errors.length > 0 && (
              <>
                <ul className="max-h-60 space-y-2 overflow-y-auto text-xs">
                  {report.errors.map((e) => (
                    <li key={e.row} className="rounded-md bg-danger-soft p-2">
                      <strong>Row {e.row}</strong> (day {e.dayNumber || "?"}): {e.errors.join("; ")}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" size="sm" onClick={() => download("import-errors.csv", toCsv(["row", "dayNumber", "errors"], report.errors.map((e) => [e.row, e.dayNumber, e.errors.join("; ")])))}>
                  <Download /> Download error report
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
