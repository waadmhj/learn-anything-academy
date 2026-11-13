"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useStudyTimer } from "@/components/lesson-parts";
import { emptyAnswer, QuestionCard, type AnswerState } from "@/components/quiz";
import { Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, Tabs, pct } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";
import type { QuizQuestion } from "@/lib/types";

type Mode = "revision" | "exam";

function Session({ questions, mode, onRestart }: { questions: QuizQuestion[]; mode: Mode; onRestart: () => void }) {
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [scores, setScores] = useState<Record<string, number>>({});
  const record = (q: QuizQuestion) => async (s: AnswerState) => {
    const r = await api<{ score: number }>(`/questions/${encodeURIComponent(q.id)}/attempt`, { method: "POST", json: { response: s.response, self_grade: s.selfGrade, mode } });
    setScores((x) => ({ ...x, [q.id]: r.score }));
  };
  const done = Object.keys(scores).length;
  const avg = done ? Object.values(scores).reduce((a, b) => a + b, 0) / done : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-fg-2">
        <span>{done}/{questions.length} answered{avg != null && ` · running score ${pct(avg)}`}</span>
        <Button size="sm" variant="ghost" onClick={onRestart}><RotateCcw className="size-3.5" /> New session</Button>
      </div>
      {questions.map((q, i) => (
        <QuestionCard key={q.id} q={q} index={i} state={answers[q.id] ?? emptyAnswer()} onChange={(s) => setAnswers((a) => ({ ...a, [q.id]: s }))} onRecord={record(q)} />
      ))}
      {done === questions.length && (
        <Card className="p-5">
          <p className="text-lg font-semibold">Session score: {pct(avg)}</p>
          <p className="mt-1 text-sm text-fg-2">
            {mode === "revision"
              ? "Low scores on a completed lesson flag it for revision automatically. Check the course dashboard."
              : "Exam questions come from every written lesson, so some may cover lessons you haven't studied yet."}
          </p>
          <Button className="mt-3" onClick={onRestart}>Start another session</Button>
        </Card>
      )}
    </div>
  );
}

function Revision({ base }: { base: string }) {
  const [nonce, setNonce] = useState(0);
  const { data, error, loading, reload } = useApi<{ questions: QuizQuestion[]; reason: string | null }>(`${base}/revision?n=10&_=${nonce}`);
  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data?.questions.length)
    return (
      <EmptyState title="Revision mode is locked" action={<ButtonLink href={`${base}/curriculum`} variant="primary">Go to the curriculum</ButtonLink>}>
        {data?.reason}
      </EmptyState>
    );
  return <Session key={nonce} questions={data.questions} mode="revision" onRestart={() => setNonce(nonce + 1)} />;
}

function Exam({ base }: { base: string }) {
  const [scope, setScope] = useState<"all" | "studied">("all");
  const [nonce, setNonce] = useState(0);
  const { data, error, loading, reload } = useApi<QuizQuestion[]>(`${base}/exam?n=12&scope=${scope}&_=${nonce}`);
  return (
    <div className="space-y-4">
      <Tabs value={scope} onChange={(v) => { setScope(v); setNonce(nonce + 1); }} items={[{ value: "all", label: "Whole course" }, { value: "studied", label: "Lessons I've started" }]} />
      {loading && !data ? (
        <PageSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <EmptyState title="No exam questions yet">
          Exam questions come from written lessons. {scope === "studied" ? "Start a written lesson first." : "Write some lessons from the course dashboard first."}
        </EmptyState>
      ) : (
        <Session key={`${scope}-${nonce}`} questions={data} mode="exam" onRestart={() => setNonce(nonce + 1)} />
      )}
    </div>
  );
}

export default function AssessmentsPage() {
  const { base } = useCoursePage();
  const [mode, setMode] = useState<Mode>("revision");
  useStudyTimer();
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Assessments"
        title={mode === "revision" ? "Revision mode" : "Exam mode"}
        description={
          mode === "revision"
            ? "A cumulative session mixing questions from lessons you've studied, weakest topics first. Answer before you see any explanation."
            : "A mixed exam across the course, in random order, to test whether it all fits together."
        }
        actions={<Tabs value={mode} onChange={setMode} items={[{ value: "revision", label: "Revision" }, { value: "exam", label: "Exam" }]} />}
      />
      <div className="mx-auto max-w-3xl">{mode === "revision" ? <Revision base={base} /> : <Exam base={base} />}</div>
    </div>
  );
}
