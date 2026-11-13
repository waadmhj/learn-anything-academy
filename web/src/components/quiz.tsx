"use client";

import { Check, CheckCircle2, Circle, Eye, X, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import type { GradeResult, QuizQuestion } from "@/lib/types";
import { Markdown } from "./markdown";
import { Badge, Button, cn, pct } from "./ui";

type SelfGrade = "correct" | "partial" | "incorrect";
export interface AnswerState {
  response: number | number[] | string | null;
  checked: GradeResult | null;
  selfGrade: SelfGrade | null;
}
const KIND_LABEL: Record<QuizQuestion["kind"], string> = {
  mcq: "Multiple choice", multi: "Select all that apply", short: "Short answer", technical: "Technical", practical: "Practical", scenario: "Scenario",
};
const OPEN = new Set(["short", "technical", "practical", "scenario"]);

/**
 * Active recall: the learner commits to an answer before any explanation is shown.
 * Closed questions are graded immediately; open ones reveal a model answer + key-idea coverage and ask for an honest self-grade.
 */
export function QuestionCard({ q, index, state, onChange, onRecord }: {
  q: QuizQuestion;
  index: number;
  state: AnswerState;
  onChange: (s: AnswerState) => void;
  onRecord?: (s: AnswerState) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const locked = !!state.checked;
  const open = OPEN.has(q.kind);
  const hasAnswer = q.kind === "multi" ? Array.isArray(state.response) && state.response.length > 0 : open ? typeof state.response === "string" && state.response.trim().length > 0 : typeof state.response === "number";

  const check = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<GradeResult>(`/questions/${encodeURIComponent(q.id)}/check`, { method: "POST", json: { response: state.response } });
      const next = { ...state, checked: r };
      onChange(next);
      if (!open && onRecord) await onRecord(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const grade = async (g: SelfGrade) => {
    const next = { ...state, selfGrade: g };
    onChange(next);
    if (onRecord) {
      setBusy(true);
      try {
        await onRecord(next);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
  };

  const correctSet = new Set(Array.isArray(state.checked?.correct_answer) ? state.checked?.correct_answer : typeof state.checked?.correct_answer === "number" ? [state.checked.correct_answer] : []);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-fg-3">
        <span className="font-medium text-fg-2">Question {index + 1}</span>
        <Badge>{KIND_LABEL[q.kind]}</Badge>
        {q.lesson_title && <span className="truncate">from {q.lesson_title}</span>}
      </div>
      <Markdown className="text-[15px]">{q.prompt}</Markdown>

      {(q.kind === "mcq" || q.kind === "multi") && (
        <div className="mt-3 space-y-2" role={q.kind === "mcq" ? "radiogroup" : "group"}>
          {q.options.map((opt, i) => {
            const selected = q.kind === "mcq" ? state.response === i : Array.isArray(state.response) && state.response.includes(i);
            const isCorrect = correctSet.has(i);
            return (
              <button
                key={i}
                role={q.kind === "mcq" ? "radio" : "checkbox"}
                aria-checked={selected}
                disabled={locked}
                onClick={() => {
                  if (q.kind === "mcq") onChange({ ...state, response: i });
                  else {
                    const cur = Array.isArray(state.response) ? state.response : [];
                    onChange({ ...state, response: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i] });
                  }
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  !locked && (selected ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong hover:bg-surface-2"),
                  locked && isCorrect && "border-success bg-success-soft",
                  locked && selected && !isCorrect && "border-danger bg-danger-soft",
                  locked && !selected && !isCorrect && "border-border opacity-70",
                )}
              >
                <span className="mt-0.5">
                  {locked ? (isCorrect ? <CheckCircle2 className="size-4 text-success" /> : selected ? <XCircle className="size-4 text-danger" /> : <Circle className="size-4 text-fg-3" />) : selected ? <CheckCircle2 className="size-4 text-accent" /> : <Circle className="size-4 text-fg-3" />}
                </span>
                <Markdown inline className="text-sm">{opt}</Markdown>
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <textarea
          value={typeof state.response === "string" ? state.response : ""}
          onChange={(e) => onChange({ ...state, response: e.target.value })}
          disabled={locked}
          rows={4}
          placeholder="Write your answer from memory before revealing the model answer…"
          aria-label={`Answer to question ${index + 1}`}
          className="mt-3 w-full resize-y rounded-lg border border-border bg-bg p-3 text-sm focus:border-accent focus:outline-none disabled:opacity-80"
        />
      )}

      {!locked && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={check} disabled={!hasAnswer} loading={busy}>
            {open ? (
              <>
                <Eye className="size-3.5" /> Reveal model answer
              </>
            ) : (
              "Check answer"
            )}
          </Button>
          {!hasAnswer && <span className="text-xs text-fg-3">Answer first, then check.</span>}
        </div>
      )}

      {state.checked && !open && (
        <div className={cn("mt-3 rounded-lg p-3 text-sm", state.checked.correct ? "bg-success-soft" : state.checked.score && state.checked.score > 0 ? "bg-warning-soft" : "bg-danger-soft")}>
          <p className="font-medium">
            {state.checked.correct ? "Correct" : state.checked.score && state.checked.score > 0 ? `Partially correct (${pct(state.checked.score)})` : "Not quite"}
          </p>
          {state.checked.explanation && <Markdown className="mt-1 text-sm text-fg-2">{state.checked.explanation}</Markdown>}
        </div>
      )}

      {state.checked && open && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-3">Model answer</p>
            <Markdown className="text-sm">{state.checked.model_answer ?? ""}</Markdown>
          </div>
          {state.checked.keyword_coverage != null && (
            <p className="text-xs text-fg-2">
              Key ideas found in your answer: <span className="font-medium">{pct(state.checked.keyword_coverage)}</span>
              {state.checked.missed_ideas.length > 0 && <> · possibly missing: {state.checked.missed_ideas.map((m) => `“${m}”`).join(", ")}</>}
            </p>
          )}
          <div>
            <p className="mb-1.5 text-xs text-fg-2">Compare honestly. How did you do?</p>
            <div className="flex flex-wrap gap-2">
              {(["correct", "partial", "incorrect"] as SelfGrade[]).map((g) => (
                <Button key={g} size="sm" variant={state.selfGrade === g ? "primary" : "secondary"} onClick={() => grade(g)} disabled={busy || (!!onRecord && !!state.selfGrade)}>
                  {g === "correct" ? <Check className="size-3.5" /> : g === "incorrect" ? <X className="size-3.5" /> : null}
                  {g === "correct" ? "I got it" : g === "partial" ? "Partly" : "Missed it"}
                </Button>
              ))}
            </div>
            {state.selfGrade === "correct" && (state.checked.keyword_coverage ?? 1) < 0.5 && (
              <p className="mt-1.5 text-xs text-warning">Your answer covers less than half the key ideas, so this counts as partial credit.</p>
            )}
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}

export const emptyAnswer = (): AnswerState => ({ response: null, checked: null, selfGrade: null });

export function isAnswered(q: QuizQuestion, s: AnswerState | undefined) {
  if (!s?.checked) return false;
  return OPEN.has(q.kind) ? !!s.selfGrade : true;
}
