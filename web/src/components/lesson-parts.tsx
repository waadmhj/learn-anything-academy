"use client";

import { CheckCircle2, ClipboardCheck, FlaskConical, Lightbulb, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Lesson, LessonProgress } from "@/lib/types";
import { Markdown } from "./markdown";
import { emptyAnswer, isAnswered, QuestionCard, type AnswerState } from "./quiz";
import { Badge, Button, Card, cn, pct } from "./ui";

/** Counts focused study time: sends a heartbeat every 60 s while the tab is visible. */
export function useStudyTimer(lessonId?: string) {
  useEffect(() => {
    let last = Date.now();
    const flush = () => {
      const secs = Math.round((Date.now() - last) / 1000);
      last = Date.now();
      if (secs >= 5 && document.visibilityState === "visible") {
        api("/progress/heartbeat", { method: "POST", json: { seconds: Math.min(secs, 120), lesson_id: lessonId ?? null } }).catch(() => {});
      }
    };
    const t = setInterval(flush, 60_000);
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
      else last = Date.now();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [lessonId]);
}

const looksLikeCode = (s?: string | null) => !!s && /[{};=()]|def |function |import |^\s{4}/m.test(s);

export function ExercisePanel({ lesson, onProgress }: { lesson: Lesson; onProgress: (p: LessonProgress) => void }) {
  const ex = lesson.exercise!;
  const [code, setCode] = useState(ex.starter ?? "");
  const [hints, setHints] = useState(0);
  const [result, setResult] = useState<{ solution: string; explanation: string; advanced?: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (self_check: "solved" | "partial" | "stuck") => {
    setBusy(self_check);
    setErr(null);
    try {
      const r = await api<{ solution: string; explanation: string; advanced?: string | null; progress: LessonProgress }>(`/lessons/${lesson.id}/exercise`, { method: "POST", json: { code, self_check } });
      setResult(r);
      onProgress(r.progress);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card as="section" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="size-4 text-accent" />
        <h2 id="exercise" className="scroll-mt-20 text-lg font-semibold">Practice: {ex.title}</h2>
        {(ex.submitted || result) && <Badge tone="success">Submitted</Badge>}
      </div>
      <Markdown className="mt-3">{ex.prompt}</Markdown>
      <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-3">A good answer…</p>
        <Markdown>{ex.expected}</Markdown>
      </div>

      <label htmlFor="exercise-code" className="mt-4 block text-sm font-medium">
        Your answer <span className="font-normal text-fg-3">(write it here, or work elsewhere and paste it in)</span>
      </label>
      <textarea
        id="exercise-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={Math.min(18, Math.max(8, code.split("\n").length + 1))}
        className={cn(
          "mt-2 w-full resize-y rounded-lg border border-border p-3 leading-relaxed focus:border-accent focus:outline-none",
          looksLikeCode(ex.starter) ? "bg-[var(--code-bg)] font-mono text-[13px]" : "bg-surface text-sm",
        )}
      />

      <div className="mt-3 space-y-2">
        {ex.hints.slice(0, hints).map((h, i) => (
          <div key={i} className="flex gap-2 rounded-lg bg-warning-soft p-3 text-sm">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
            <Markdown inline>{h}</Markdown>
          </div>
        ))}
        {hints < ex.hints.length && !result && (
          <Button size="sm" variant="ghost" onClick={() => setHints(hints + 1)}>
            <Lightbulb className="size-3.5" /> Show hint {hints + 1} of {ex.hints.length}
          </Button>
        )}
      </div>

      {!result ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-sm text-fg-2">Submit your attempt to unlock the reference solution and explanation:</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => submit("solved")} loading={busy === "solved"} disabled={!!busy}>
              <CheckCircle2 className="size-4" /> I solved it
            </Button>
            <Button onClick={() => submit("partial")} loading={busy === "partial"} disabled={!!busy}>
              Partly working
            </Button>
            <Button variant="ghost" onClick={() => submit("stuck")} loading={busy === "stuck"} disabled={!!busy}>
              I&apos;m stuck, show me
            </Button>
          </div>
          {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        </div>
      ) : (
        <div className="mt-5 space-y-4 border-t border-border pt-4 fade-in">
          <div>
            <p className="mb-1 text-sm font-semibold">Model solution</p>
            <Markdown>{result.solution}</Markdown>
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold">Why it works</p>
            <Markdown>{result.explanation}</Markdown>
          </div>
          {result.advanced && (
            <div className="rounded-lg border border-accent/30 bg-accent-soft p-4">
              <p className="mb-1 text-sm font-semibold text-accent-text">Advanced challenge (optional)</p>
              <Markdown>{result.advanced}</Markdown>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
            <RotateCcw className="size-3.5" /> Submit another attempt
          </Button>
        </div>
      )}
    </Card>
  );
}

export function LessonQuiz({ lesson, onProgress }: { lesson: Lesson; onProgress: (p: LessonProgress) => void }) {
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [result, setResult] = useState<{ score: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = lesson.quiz.filter((q) => isAnswered(q, answers[q.id])).length;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ score: number; progress: LessonProgress }>(`/lessons/${lesson.id}/quiz`, {
        method: "POST",
        json: { answers: lesson.quiz.map((q) => ({ question_id: q.id, response: answers[q.id]?.response ?? null, self_grade: answers[q.id]?.selfGrade ?? null })) },
      });
      setResult(r);
      onProgress(r.progress);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="quiz" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="quiz" className="flex scroll-mt-20 items-center gap-2 text-lg font-semibold">
            <ClipboardCheck className="size-4 text-accent" /> Knowledge check
          </h2>
          <p className="mt-0.5 text-sm text-fg-2">
            Multiple-choice, technical, practical, short-answer and scenario questions. You need 70% to complete the lesson and 85% plus the exercise to master it.
            {lesson.progress.quiz_best != null && <> Best so far: <span className="font-medium">{pct(lesson.progress.quiz_best)}</span>.</>}
          </p>
        </div>
        <span className="text-xs tabular-nums text-fg-3">
          {done}/{lesson.quiz.length} answered
        </span>
      </div>
      {lesson.quiz.map((q, i) => (
        <QuestionCard key={q.id} q={q} index={i} state={answers[q.id] ?? emptyAnswer()} onChange={(s) => setAnswers((a) => ({ ...a, [q.id]: s }))} />
      ))}
      {result ? (
        <Card className={cn("p-5", result.score >= 0.7 ? "border-success/40" : "border-warning/40")}>
          <p className="text-lg font-semibold">Score: {pct(result.score)}</p>
          <p className="mt-1 text-sm text-fg-2">
            {result.score >= 0.85 ? "Excellent. Submit the exercise too and this lesson counts as mastered." : result.score >= 0.7 ? "Lesson completed. Review what you missed, then come back to aim for mastery." : "Not there yet. Re-read the sections behind the questions you missed, then try again."}
            {" "}This lesson&apos;s flashcards are now in your review deck.
          </p>
          <Button className="mt-3" size="sm" onClick={() => { setAnswers({}); setResult(null); document.getElementById("quiz")?.scrollIntoView({ behavior: "smooth" }); }}>
            <RotateCcw className="size-3.5" /> Retake
          </Button>
        </Card>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={submit} disabled={done < lesson.quiz.length} loading={busy}>
            Submit knowledge check
          </Button>
          {done < lesson.quiz.length && <span className="text-xs text-fg-3">Answer and check every question first.</span>}
          {err && <span className="text-sm text-danger">{err}</span>}
        </div>
      )}
    </section>
  );
}

export function ObjectivesChecklist({ lesson, onProgress }: { lesson: Lesson; onProgress: (p: LessonProgress) => void }) {
  const [checked, setChecked] = useState<number[]>(lesson.progress.objectives_checked ?? []);
  const [err, setErr] = useState<string | null>(null);
  const toggle = async (i: number) => {
    const next = checked.includes(i) ? checked.filter((x) => x !== i) : [...checked, i];
    setChecked(next);
    try {
      onProgress(await api<LessonProgress>(`/lessons/${lesson.id}/objectives`, { method: "PUT", json: { checked: next } }));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card as="section" className="p-5 sm:p-6">
      <h2 id="self-check" className="flex scroll-mt-20 items-center gap-2 text-lg font-semibold">
        <ClipboardCheck className="size-4 text-accent" /> Self-check
      </h2>
      <p className="mt-1 text-sm text-fg-2">
        This lesson is a guided outline. Study the required resources, then tick each objective only when you can explain it without notes. Self-checked lessons count as completed; mastery needs the written lesson&apos;s knowledge check and practice task.
      </p>
      <ul className="mt-4 space-y-2">
        {lesson.objectives.map((o, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-surface-2">
              <input type="checkbox" checked={checked.includes(i)} onChange={() => toggle(i)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span className="text-sm">I can {o.charAt(0).toLowerCase() + o.slice(1)}</span>
            </label>
          </li>
        ))}
      </ul>
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
    </Card>
  );
}
