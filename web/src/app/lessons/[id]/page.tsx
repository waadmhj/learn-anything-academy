"use client";

import { AlertTriangle, Bot, ChevronLeft, ChevronRight, Clock, Compass, Layers, Loader2, PanelLeftClose, PanelLeftOpen, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { AnnotationLayer } from "@/components/annotations/layer";
import { LessonNotesPanel } from "@/components/annotations/notes-panel";
import { useAnnotations } from "@/components/annotations/use-annotations";
import { LessonStatusBadge } from "@/components/course-bits";
import { ExercisePanel, LessonQuiz, ObjectivesChecklist, useStudyTimer } from "@/components/lesson-parts";
import { Markdown } from "@/components/markdown";
import { ResourceCard } from "@/components/resources";
import { TutorChat } from "@/components/tutor-chat";
import { Badge, Button, Card, ErrorState, PageSkeleton, ProgressBar, STATUS_META, StatusDot, cn, levelTone, pct } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useMarkCourse } from "@/lib/course";
import type { Lesson, LessonProgress, ModuleDetail, Section, Status } from "@/lib/types";

/** Outline lessons: write the full lesson with AI, showing progress until it's ready. */
function WriteLesson({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const [status, setStatus] = useState(lesson.content_status);
  const [error, setError] = useState<string | null>(lesson.gen_error);
  useEffect(() => {
    if (status !== "generating") return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ status: Lesson["content_status"]; error: string | null }>(`/lessons/${lesson.id}/write`);
        setStatus(r.status);
        setError(r.error);
        if (r.status === "authored") onDone();
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [status, lesson.id, onDone]);
  const start = async () => {
    setError(null);
    try {
      const r = await api<{ status: Lesson["content_status"]; error: string | null }>(`/lessons/${lesson.id}/write`, { method: "POST" });
      setStatus(r.status);
      setError(r.error);
      if (r.status === "authored") onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (status === "generating") {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm" aria-live="polite">
        <Loader2 className="size-5 shrink-0 animate-spin text-accent" />
        <div>
          <p className="font-medium text-accent-text">Writing this lesson…</p>
          <p className="text-fg-2">Explanations, a worked example, a practice task, a knowledge check and flashcards. It takes about a minute; the page updates by itself.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm">
      {status === "failed" || error ? (
        <p className="flex items-start gap-2 text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error ?? "This lesson couldn't be written."}
        </p>
      ) : (
        <p className="text-fg-2">This lesson is an outline. Write it in full to get explanations from simple to technical, a worked example, practice, a knowledge check and flashcards.</p>
      )}
      <Button className="mt-3" variant="primary" onClick={start}>
        <Sparkles className="size-4" /> {status === "failed" || error ? "Try again" : "Write this lesson"}
      </Button>
    </div>
  );
}

const SECTION_LABEL: Record<Section["kind"], string> = {
  simple: "Simple explanation", technical: "Technical explanation", example: "Worked example", diagram: "Diagram", math: "Mathematics", code: "Code",
  real_world: "In the real world", mistakes: "Common mistakes", when: "When to use it",
};

function SectionBlock({ s, i }: { s: Section; i: number }) {
  return (
    <section id={`s-${i}`} data-anchor={`s-${i}`} data-annotatable aria-labelledby={`s-${i}-h`} className="scroll-mt-20">
      <p className="text-xs font-medium uppercase tracking-wide text-accent-text">{SECTION_LABEL[s.kind]}</p>
      <h2 id={`s-${i}-h`} className="mt-1 text-xl font-semibold tracking-tight">{s.title}</h2>
      {s.svg && (
        <figure className="mt-4 rounded-xl border border-border bg-surface p-4">
          {/* Trusted, repository-authored SVG diagrams (themed via currentColor and CSS variables). */}
          <div className="diagram" dangerouslySetInnerHTML={{ __html: s.svg }} />
          {s.caption && (
            <figcaption className="mt-3 text-center text-sm text-fg-2">
              <Markdown inline>{s.caption}</Markdown>
            </figcaption>
          )}
        </figure>
      )}
      {s.body && <Markdown className="mt-3">{s.body}</Markdown>}
    </section>
  );
}

function StatusControl({ lesson, progress, onProgress }: { lesson: Lesson; progress: LessonProgress; onProgress: (p: LessonProgress) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const set = async (status: Status) => {
    setErr(null);
    try {
      onProgress(await api<LessonProgress>(`/lessons/${lesson.id}/status`, { method: "PUT", json: { status } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const options: Status[] = ["not_started", "in_progress", "completed", "needs_revision", "mastered"];
  return (
    <div>
      <label htmlFor="status" className="text-xs text-fg-3">Status</label>
      <select id="status" value={progress.status} onChange={(e) => set(e.target.value as Status)} className="mt-1 h-8 w-full rounded-lg border border-border bg-surface px-2 text-[13px] focus:border-accent focus:outline-none">
        {options.map((o) => (
          <option key={o} value={o} disabled={(o === "completed" && !progress.can_complete && progress.status !== "completed") || (o === "mastered" && !progress.can_master && progress.status !== "mastered")}>
            {STATUS_META[o].label}
          </option>
        ))}
      </select>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      <p className="mt-1 text-[11px] leading-snug text-fg-3">
        {lesson.content_status === "authored" ? "Completed: ≥70% on the check. Mastered: ≥85%, exercise submitted and flashcards retained." : "Completed once every objective is self-checked."}
      </p>
    </div>
  );
}

export default function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: lesson, error, loading, reload, setData } = useApi<Lesson>(`/lessons/${id}`);
  const moduleId = lesson?.module.id;
  const { data: mod } = useApi<ModuleDetail>(moduleId ? `/modules/${moduleId}` : null);
  useMarkCourse(lesson?.course);
  const [navOpen, setNavOpen] = useState(true);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [orphans, setOrphans] = useState<number[]>([]);
  const ann = useAnnotations(id);
  useStudyTimer(id);

  useEffect(() => {
    api<LessonProgress>(`/lessons/${id}/open`, { method: "POST" })
      .then((p) => setData((l) => (l ? { ...l, progress: p } : l)))
      .catch(() => {});
  }, [id, setData]);

  if (loading && !lesson) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!lesson) return null;
  const onProgress = (p: LessonProgress) => setData((l) => (l ? { ...l, progress: p } : l));
  const p = lesson.progress;
  const authored = lesson.content_status === "authored";
  const required = lesson.resources.filter((r) => r.role === "required");
  const supplementary = lesson.resources.filter((r) => r.role !== "required");
  const video = required.find((r) => r.embed.youtube) ?? supplementary.find((r) => r.embed.youtube);
  const outline = [
    { id: "overview", label: "Overview" },
    ...lesson.sections.map((s, i) => ({ id: `s-${i}`, label: s.title })),
    ...(lesson.exercise ? [{ id: "exercise", label: "Exercise" }] : []),
    ...(authored ? [{ id: "quiz", label: "Knowledge check" }] : [{ id: "self-check", label: "Self-check" }]),
    { id: "resources", label: "Resources" },
  ];

  return (
    <div className="fade-in -mx-4 sm:-mx-6 lg:-mx-8">
      <div className="flex">
        {/* Left: curriculum navigation */}
        <aside className={cn("sticky top-0 hidden h-dvh shrink-0 overflow-y-auto border-r border-border bg-bg-subtle/60 py-6 scrollbar-thin xl:block", navOpen ? "w-64 px-3" : "w-12 px-1.5")}>
          <button onClick={() => setNavOpen(!navOpen)} className="mb-3 rounded-md p-1.5 text-fg-3 hover:bg-surface-2" aria-label={navOpen ? "Collapse lesson list" : "Expand lesson list"}>
            {navOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </button>
          {navOpen && mod && (
            <nav aria-label="Lessons in this module">
              <Link href={`/modules/${mod.id}`} className="block px-2 text-xs font-medium text-fg-3 hover:text-fg">{mod.title}</Link>
              <ol className="mt-2 space-y-0.5">
                {mod.lessons.map((l, i) => (
                  <li key={l.id}>
                    <Link href={`/lessons/${l.id}`} aria-current={l.id === lesson.id ? "page" : undefined} className={cn("flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px]", l.id === lesson.id ? "bg-surface text-fg shadow-[var(--shadow)]" : "text-fg-2 hover:bg-surface-2")}>
                      <StatusDot status={l.id === lesson.id ? p.status : l.status} className="mt-1.5" />
                      <span className="leading-snug">
                        <span className="text-fg-3">{i + 1}. </span>
                        {l.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </aside>

        {/* Main content */}
        <article className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <AnnotationLayer ann={ann} onOrphans={setOrphans} className="mx-auto max-w-3xl" contentClassName="space-y-10">
            <header id="overview" data-anchor="overview" data-annotatable className="scroll-mt-20">
              <nav aria-label="Breadcrumb" className="text-xs text-fg-3">
                <Link href={`/courses/${lesson.course.id}`} className="hover:text-fg">{lesson.course.title}</Link> /{" "}
                <Link href={`/courses/${lesson.course.id}/paths/${lesson.stage.id}`} className="hover:text-fg">Stage {lesson.stage.order}</Link> /{" "}
                <Link href={`/modules/${lesson.module.id}`} className="hover:text-fg">{lesson.module.title}</Link>
              </nav>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{lesson.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-3">
                <Badge tone={levelTone(lesson.level)}>{lesson.level}</Badge>
                <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {lesson.minutes} min</span>
                <LessonStatusBadge status={lesson.content_status} />
                {lesson.flashcards > 0 && <span className="inline-flex items-center gap-1"><Layers className="size-3" /> {lesson.flashcards} flashcards</span>}
              </div>

              {authored ? (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {[
                    ["What will I learn?", lesson.overview.what],
                    ["Why does it matter?", lesson.overview.why],
                    ["Where is it used?", lesson.overview.where],
                    ["Before you start", lesson.overview.prerequisites],
                  ].map(([h, body]) => (
                    <div key={h} className="rounded-xl border border-border bg-surface p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-fg-3">{h}</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{body}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {lesson.can_write && <WriteLesson key={lesson.content_status} lesson={lesson} onDone={reload} />}
                  <div className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm text-fg-2">
                    <p className="flex items-center gap-1.5 font-medium text-fg"><Compass className="size-4 text-accent" /> How to study this lesson</p>
                    <p className="mt-1.5">
                      Work through the <strong>required resources</strong> below in order, take notes against each objective (highlight and add sticky notes as you go), then complete the self-check.
                    </p>
                  </div>
                </>
              )}

              <div className="mt-6">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Target className="size-4 text-accent" /> Learning objectives</p>
                <ul className="mt-2 space-y-1.5">
                  {lesson.objectives.map((o) => (
                    <li key={o} className="flex gap-2 text-sm text-fg-2">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-fg-3" />
                      {o}
                    </li>
                  ))}
                </ul>
                {lesson.covers.length > 0 && <p className="mt-3 text-xs text-fg-3">Syllabus topics: {lesson.covers.join(" · ")}</p>}
              </div>
            </header>

            {video && (
              <section aria-label="Lesson video" data-anchor="video">
                <ResourceCard r={video} showVideo />
              </section>
            )}

            {lesson.sections.map((s, i) => (
              <SectionBlock key={i} s={s} i={i} />
            ))}

            {lesson.exercise && <div data-anchor="exercise"><ExercisePanel lesson={lesson} onProgress={onProgress} /></div>}
            <div data-anchor="check">
              {authored ? <LessonQuiz lesson={lesson} onProgress={onProgress} /> : <ObjectivesChecklist lesson={lesson} onProgress={onProgress} />}
            </div>

            <section id="resources" data-anchor="resources" aria-labelledby="resources-h" className="scroll-mt-20">
              <h2 id="resources-h" className="text-lg font-semibold">Learning resources</h2>
              <p className="mt-1 text-sm text-fg-2">A short, curated list. Study the required ones; the supplementary ones go deeper.</p>
              {required.length > 0 && <h3 className="mt-5 text-sm font-semibold">Required</h3>}
              <div className="mt-2 space-y-3">{required.filter((r) => r !== video).map((r) => <ResourceCard key={r.id} r={r} />)}</div>
              {supplementary.length > 0 && <h3 className="mt-6 text-sm font-semibold">Supplementary</h3>}
              <div className="mt-2 space-y-3">{supplementary.filter((r) => r !== video).map((r) => <ResourceCard key={r.id} r={r} />)}</div>
              {lesson.resources.length === 0 && <p className="mt-3 text-sm text-fg-3">No external resources for this lesson. The lesson itself is the material.</p>}
            </section>

            <nav data-anchor="end" className="flex items-center justify-between gap-3 border-t border-border pt-6" aria-label="Lesson navigation">
              {lesson.prev ? (
                <Link href={`/lessons/${lesson.prev.id}`} className="group flex min-w-0 items-center gap-2 text-sm text-fg-2 hover:text-fg">
                  <ChevronLeft className="size-4 shrink-0" />
                  <span className="truncate">{lesson.prev.title}</span>
                </Link>
              ) : <span />}
              {lesson.next && (
                <Link href={`/lessons/${lesson.next.id}`} className="group flex min-w-0 items-center gap-2 text-right text-sm font-medium text-accent-text hover:underline">
                  <span className="truncate">{lesson.next.title}</span>
                  <ChevronRight className="size-4 shrink-0" />
                </Link>
              )}
            </nav>
          </AnnotationLayer>
        </article>

        {/* Right: outline, progress, resources, tutor */}
        <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 space-y-5 overflow-y-auto border-l border-border px-4 py-8 scrollbar-thin lg:block">
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Your progress</span>
              <span className="tabular-nums text-fg-3">{pct(p.mastery)}</span>
            </div>
            <ProgressBar value={p.mastery * 100} tone={p.status === "mastered" ? "mastered" : "accent"} label="Mastery" />
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-fg-3">Best quiz</dt><dd className="font-medium">{pct(p.quiz_best)}</dd></div>
              <div><dt className="text-fg-3">Exercise</dt><dd className="font-medium">{p.exercise_done ? "Done" : lesson.exercise ? "Pending" : "—"}</dd></div>
              <div><dt className="text-fg-3">Time spent</dt><dd className="font-medium">{Math.round(p.seconds_spent / 60)} min</dd></div>
            </dl>
            <StatusControl lesson={lesson} progress={p} onProgress={onProgress} />
          </Card>

          <nav aria-label="On this page">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-3">On this page</p>
            <ul className="space-y-1 border-l border-border">
              {outline.map((o) => (
                <li key={o.id}>
                  <a href={`#${o.id}`} className="-ml-px block border-l border-transparent py-0.5 pl-3 text-[13px] text-fg-2 hover:border-fg-3 hover:text-fg">{o.label}</a>
                </li>
              ))}
            </ul>
          </nav>

          <LessonNotesPanel ann={ann} orphans={orphans} />

          {lesson.resources.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-3">Resources</p>
              <ul className="space-y-1.5">
                {lesson.resources.map((r) => (
                  <li key={r.id}>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="block text-[13px] leading-snug text-fg-2 hover:text-accent-text">
                      {r.role === "required" && <span className="mr-1 text-accent-text">●</span>}
                      {r.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Card className="p-4">
            <button onClick={() => setTutorOpen(!tutorOpen)} className="flex w-full items-center justify-between text-sm font-medium" aria-expanded={tutorOpen}>
              <span className="flex items-center gap-1.5"><Bot className="size-4 text-accent" /> Ask your tutor</span>
              <span className="text-xs text-fg-3">{tutorOpen ? "Hide" : "Open"}</span>
            </button>
            {tutorOpen && <div className="mt-3"><TutorChat courseId={lesson.course.id} lessonId={lesson.id} compact /></div>}
          </Card>
        </aside>
      </div>

      {/* Mobile progress footer */}
      <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-bg/95 px-4 py-2 backdrop-blur lg:hidden">
        <span className="flex items-center gap-2 text-xs">
          <StatusDot status={p.status} /> {STATUS_META[p.status].label} · {pct(p.mastery)}
        </span>
        <Button size="sm" variant="ghost" onClick={() => document.getElementById(authored ? "quiz" : "self-check")?.scrollIntoView({ behavior: "smooth" })}>
          {authored ? "Knowledge check" : "Self-check"}
        </Button>
      </div>
    </div>
  );
}
