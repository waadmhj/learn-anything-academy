"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, PenLine, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api";
import { useCurrentCourse } from "@/lib/course";
import type { ContentStatus, Course } from "@/lib/types";
import { Badge, Button, Card, CardHeader, ProgressBar, cn } from "./ui";

export function LessonStatusBadge({ status }: { status: ContentStatus }) {
  if (status === "authored") return <Badge tone="accent">Written</Badge>;
  if (status === "generating") return <Badge tone="info"><Loader2 className="size-3 animate-spin" /> Writing</Badge>;
  if (status === "failed") return <Badge tone="danger">Not written</Badge>;
  return <Badge>Outline</Badge>;
}

const STEPS = ["Planning the course", "Searching for the best-rated material", "Matching resources to lessons", "Writing your first lesson", "Ready"];

/** Shown while a course is building or after a failed build. Polls until the build finishes. */
export function BuildStatus({ course, onChange }: { course: Course; onChange: () => void }) {
  const router = useRouter();
  const { setCourse } = useCurrentCourse();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (course.status !== "building") return;
    const t = setInterval(onChange, 2000);
    return () => clearInterval(t);
  }, [course.status, onChange]);

  const retry = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/courses/${course.id}/rebuild`, { method: "POST" });
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/courses/${course.id}`, { method: "DELETE" });
      setCourse(null);
      router.push("/");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  if (course.status === "failed") {
    return (
      <div className="mx-auto max-w-xl py-10 fade-in">
        <Card className="p-6">
          <AlertTriangle className="size-6 text-danger" />
          <h1 className="mt-3 text-lg font-semibold">Couldn&apos;t build “{course.title}”</h1>
          <p className="mt-1 text-sm text-fg-2">{course.error ?? "Something went wrong."}</p>
          {err && <p className="mt-2 text-sm text-danger">{err}</p>}
          <div className="mt-5 flex gap-2">
            <Button variant="primary" onClick={retry} loading={busy}>Try again</Button>
            <Button variant="ghost" onClick={remove} disabled={busy}><Trash2 className="size-4" /> Delete course</Button>
          </div>
        </Card>
      </div>
    );
  }
  const current = Math.max(0, STEPS.findIndex((s) => course.step.startsWith(s.split(" ")[0])));
  return (
    <div className="mx-auto max-w-xl py-10 fade-in" aria-live="polite">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-3">Building your course</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{course.title}</h1>
      <p className="mt-1 text-sm text-fg-2">This usually takes one to three minutes. You can leave this page; the build keeps going.</p>
      <Card className="mt-6 p-5">
        <ProgressBar value={course.progress * 100} label="Build progress" />
        <p className="mt-3 flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-accent" /> {course.step || "Starting"}
        </p>
        <ol className="mt-4 space-y-1.5 text-sm">
          {STEPS.slice(0, -1).map((s, i) => (
            <li key={s} className={cn("flex items-center gap-2", i < current ? "text-fg-2" : i === current ? "text-fg" : "text-fg-3")}>
              {i < current ? <CheckCircle2 className="size-4 text-success" /> : <span className="flex size-4 items-center justify-center text-[10px]">{i + 1}</span>}
              {s}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

/** Course dashboard card: how many lessons are written, and a button to write the rest. */
export function WriteAllCard({ course, onChange }: { course: Course; onChange: () => void }) {
  const { data: ai } = useApi<{ available: boolean }>("/ai/status");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const writing = course.lessons_writing > 0;
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(onChange, 4000);
    return () => clearInterval(t);
  }, [writing, onChange]);
  const left = course.lessons - course.lessons_written;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/courses/${course.id}/write-all`, { method: "POST" });
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Lessons" action={<PenLine className="size-4 text-fg-3" />} />
      <div className="px-5 pb-5">
        <p className="text-3xl font-semibold tabular-nums">
          {course.lessons_written}
          <span className="text-base font-normal text-fg-3">/{course.lessons} written</span>
        </p>
        <ProgressBar className="mt-2" value={course.lessons ? (course.lessons_written / course.lessons) * 100 : 0} label="Lessons written" />
        {ai && !ai.available ? (
          <p className="mt-3 text-xs text-fg-3">
            AI isn&apos;t set up, so lessons are guided outlines: objectives, the best resources and a self-check. Set ANTHROPIC_API_KEY on the API to write full lessons.
          </p>
        ) : writing ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-fg-2"><Loader2 className="size-3.5 animate-spin" /> Writing {course.lessons_writing} {course.lessons_writing === 1 ? "lesson" : "lessons"}…</p>
        ) : left > 0 ? (
          <>
            <p className="mt-3 text-xs text-fg-3">Lessons are also written one at a time when you open them. Each takes about a minute.</p>
            <Button className="mt-3 w-full" onClick={go} loading={busy}>
              <Sparkles className="size-4" /> Write the remaining {left}
            </Button>
          </>
        ) : (
          <p className="mt-3 text-xs text-success">Every lesson is written.</p>
        )}
        {course.lessons_failed > 0 && !writing && <p className="mt-2 text-xs text-danger">{course.lessons_failed} couldn&apos;t be written. Open them to retry.</p>}
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      </div>
    </Card>
  );
}

interface Coverage {
  topics: number;
  covered: number;
  items: { topic: string; lessons: { id: string; title: string }[] }[];
}

/** Every topic from the learner's syllabus, and the lessons that teach it. */
export function CoverageCard({ base }: { base: string }) {
  const { data } = useApi<Coverage>(`${base}/coverage`);
  const [open, setOpen] = useState(false);
  if (!data || data.topics === 0) return null;
  const missing = data.items.filter((i) => i.lessons.length === 0);
  return (
    <Card className="p-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open}>
        <span>
          <span className="text-sm font-medium">Syllabus coverage: {data.covered} of {data.topics} topics</span>
          <span className="block text-xs text-fg-3">{missing.length ? `${missing.length} not mapped to a lesson yet` : "Every topic is taught by at least one lesson."}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-fg-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {data.items.map((i) => (
            <li key={i.topic} className="flex gap-2">
              {i.lessons.length ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />}
              <span>
                {i.topic}
                {i.lessons.length > 0 && (
                  <span className="text-fg-3">
                    {" → "}
                    {i.lessons.slice(0, 2).map((l, k) => (
                      <span key={l.id}>
                        {k > 0 && ", "}
                        <Link href={`/lessons/${l.id}`} className="hover:text-accent-text hover:underline">{l.title}</Link>
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CourseCard({ c }: { c: Course }) {
  return (
    <Link href={`/courses/${c.id}`} className="group block">
      <Card className="flex h-full flex-col p-5 transition-colors group-hover:border-border-strong">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{c.level}</Badge>
          {c.status === "building" && <Badge tone="info"><Loader2 className="size-3 animate-spin" /> Building</Badge>}
          {c.status === "failed" && <Badge tone="danger">Build failed</Badge>}
          {c.status === "ready" && c.used_ai && <Badge tone="accent">AI-written</Badge>}
        </div>
        <h2 className="mt-2 text-base font-semibold leading-snug group-hover:text-accent-text">{c.title}</h2>
        <p className="mt-1 line-clamp-2 text-sm text-fg-2">{c.summary || c.goal || c.subject}</p>
        <div className="mt-auto pt-4">
          {c.status === "ready" ? (
            <>
              <ProgressBar value={c.percent ?? 0} label={`${c.title} progress`} />
              <p className="mt-1.5 text-xs text-fg-3">
                {c.completed ?? 0}/{c.lessons} lessons done · {c.lessons_written} written · {c.resources} resources
              </p>
            </>
          ) : (
            <p className="text-xs text-fg-3">{c.status === "building" ? c.step : c.error}</p>
          )}
        </div>
      </Card>
    </Link>
  );
}
