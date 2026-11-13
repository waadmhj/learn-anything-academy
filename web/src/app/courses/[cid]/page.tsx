"use client";

import { ArrowRight, BookOpenCheck, Clock, Flame, Layers, RotateCcw, Sparkles, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";
import { BuildStatus, WriteAllCard } from "@/components/course-bits";
import { PinnedNotes } from "@/components/annotations/notebook-item";
import type { Dashboard, LessonBrief, NotebookEntry } from "@/lib/types";
import {
  Badge, ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton, ProgressBar, Ring, Stat, StatusBadge, pct,
} from "@/components/ui";

function LessonRow({ lesson, extra }: { lesson: LessonBrief; extra?: React.ReactNode }) {
  return (
    <Link href={`/lessons/${lesson.id}`} className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium group-hover:text-accent-text">{lesson.title}</p>
        <p className="mt-0.5 text-xs text-fg-3">
          {lesson.minutes} min · {lesson.content_status === "authored" ? "Written lesson" : "Outline"}
          {extra}
        </p>
      </div>
      <StatusBadge status={lesson.status} />
    </Link>
  );
}

const ACTIVITY_LABEL: Record<string, string> = {
  started: "Started", quiz: "Quiz", exercise: "Exercise", status: "Status", project: "Project", milestone: "Milestone", workshop: "Workshop", tutor: "Tutor",
};

export default function DashboardPage() {
  const { base, data: course, reload: reloadCourse } = useCoursePage();
  const ready = course?.status === "ready";
  const { data, error, loading, reload } = useApi<Dashboard>(ready ? `${base}/dashboard` : null);
  const { data: pinned } = useApi<NotebookEntry[]>("/notebook?pinned=true");
  if (course && !ready) return <BuildStatus course={course} onChange={() => { reloadCourse(); reload(); }} />;
  if ((loading && !data) || !course) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const t = data.totals;
  const fresh = t.completed === 0 && !data.continue;
  const goalPct = Math.min(100, (t.today_minutes / Math.max(1, data.user.daily_goal_minutes)) * 100);

  return (
    <div className="fade-in space-y-6">
      <PageHeader
        eyebrow={data.current_stage ? `${course.subject} · Stage ${data.current_stage.order}: ${data.current_stage.title}` : course.subject}
        title={course.title}
        description={
          fresh
            ? course.summary || "Every lesson builds on the previous one. Start with lesson 1."
            : `You've completed ${t.completed} of ${t.lessons} lessons. Here's where to pick up.`
        }
        actions={
          (data.continue || data.next) && (
            <ButtonLink href={`/lessons/${(data.continue ?? data.next)!.id}`} variant="primary">
              {data.continue ? "Continue learning" : fresh ? "Start lesson 1" : "Next lesson"} <ArrowRight className="size-4" />
            </ButtonLink>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Curriculum complete" icon={<Target className="size-3.5" />} value={`${t.percent}%`} hint={`${t.completed}/${t.lessons} lessons · ${t.modules_completed}/${t.modules} modules`} />
        <Stat label="Mastered" icon={<Trophy className="size-3.5" />} value={t.mastered} hint={t.avg_quiz != null ? `Average best quiz ${pct(t.avg_quiz)}` : "Score ≥ 85% + exercise"} />
        <Stat label="Study time" icon={<Clock className="size-3.5" />} value={`${t.study_hours}h`} hint={`${t.today_minutes} of ${data.user.daily_goal_minutes} min today`} />
        <Stat label="Streak" icon={<Flame className="size-3.5" />} value={`${t.streak} ${t.streak === 1 ? "day" : "days"}`} hint={`Longest ${t.longest_streak}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Your path" subtitle={`${data.stages.length} stages · ${t.modules} modules · ${t.lessons} lessons`} action={<Link href={`${base}/paths`} className="text-xs text-accent-text hover:underline">View path</Link>} />
            <ol className="space-y-3 px-5 pb-5">
              {data.stages.map((s) => {
                const p = s.lessons ? (s.completed / s.lessons) * 100 : 0;
                const current = data.current_stage?.id === s.id;
                return (
                  <li key={s.id}>
                    <Link href={`${base}/paths/${s.id}`} className="group block">
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          <span className={`flex size-5 items-center justify-center rounded-full text-[11px] ${current ? "bg-accent text-white" : "bg-surface-2 text-fg-3"}`}>{s.order}</span>
                          <span className="group-hover:text-accent-text">{s.title}</span>
                          {current && <Badge tone="accent">You are here</Badge>}
                        </span>
                        <span className="text-xs tabular-nums text-fg-3">
                          {s.completed}/{s.lessons}
                        </span>
                      </div>
                      <ProgressBar value={p} tone={p === 100 ? "success" : "accent"} label={`${s.title} progress`} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader title="Continue learning" />
              <div className="px-2 pb-3">
                {data.continue ? <LessonRow lesson={data.continue} /> : <p className="px-3 pb-2 text-sm text-fg-3">No lesson in progress yet.</p>}
              </div>
              <CardHeader title="Recommended next" subtitle="Respects module prerequisites" />
              <div className="px-2 pb-3">
                {data.next ? <LessonRow lesson={data.next} /> : <p className="px-3 pb-2 text-sm text-fg-3">You&apos;ve finished every lesson.</p>}
              </div>
            </Card>

            <Card>
              <CardHeader title="Revision queue" subtitle="Lessons flagged or below mastery" action={<RotateCcw className="size-4 text-fg-3" />} />
              <div className="px-2 pb-3">
                {data.revision_queue.length === 0 ? (
                  <p className="px-3 pb-2 text-sm text-fg-3">Nothing to revise. Lessons appear here when mastery drops or you flag them.</p>
                ) : (
                  data.revision_queue.map((l) => <LessonRow key={l.id} lesson={l} extra={<> · {l.reason}</>} />)
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Recent activity" />
            <div className="px-5 pb-4">
              {data.activity.length === 0 ? (
                <EmptyState title="No activity yet" icon={<Sparkles className="size-6" />}>
                  Open your first lesson. Quizzes, exercises and milestones will show up here.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-border">
                  {data.activity.map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge>{ACTIVITY_LABEL[a.kind] ?? a.kind}</Badge>
                        <span className="truncate text-fg-2">{a.detail}</span>
                      </span>
                      <time className="shrink-0 text-xs text-fg-3" dateTime={a.at}>
                        {new Date(a.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <WriteAllCard course={course} onChange={reloadCourse} />

          <Card className="p-5">
            <div className="flex items-center gap-4">
              <Ring value={goalPct} size={72} label={`${t.today_minutes}m`} />
              <div>
                <p className="text-sm font-medium">Today&apos;s goal</p>
                <p className="text-xs text-fg-3">{data.user.daily_goal_minutes} minutes of focused study</p>
                <Link href="/settings" className="mt-1 inline-block text-xs text-accent-text hover:underline">Adjust goal</Link>
              </div>
            </div>
          </Card>

          {pinned && pinned.length > 0 && (
            <Card>
              <CardHeader title="Pinned notes" action={<Link href="/notebook" className="text-xs text-accent-text hover:underline">Notebook</Link>} />
              <PinnedNotes entries={pinned} />
            </Card>
          )}

          <Card>
            <CardHeader title="Flashcards due" action={<Layers className="size-4 text-fg-3" />} />
            <div className="px-5 pb-5">
              <p className="text-3xl font-semibold tabular-nums">{t.due_cards}</p>
              <p className="mt-1 text-xs text-fg-3">Cards join your deck after each knowledge check.</p>
              <ButtonLink href="/flashcards" className="mt-3 w-full" variant={t.due_cards ? "primary" : "secondary"}>
                {t.due_cards ? "Review now" : "Open flashcards"}
              </ButtonLink>
            </div>
          </Card>

          <Card>
            <CardHeader title="Upcoming assessments" action={<BookOpenCheck className="size-4 text-fg-3" />} />
            <div className="px-2 pb-3">
              {data.upcoming_assessments.length === 0 ? (
                <p className="px-3 pb-2 text-sm text-fg-3">Knowledge checks for lessons in progress will appear here.</p>
              ) : (
                data.upcoming_assessments.map((a) => (
                  <Link key={a.lesson_id} href={`/lessons/${a.lesson_id}#quiz`} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                    <span className="truncate">{a.title}</span>
                    <span className="text-xs text-fg-3">{a.best == null ? "Not attempted" : `Best ${pct(a.best)}`}</span>
                  </Link>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Weak areas" subtitle="Modules averaging below 70%" />
            <div className="space-y-3 px-5 pb-5">
              {data.weak_areas.length === 0 ? (
                <p className="text-sm text-fg-3">No weak areas detected yet. This needs at least three answers per module.</p>
              ) : (
                data.weak_areas.map((w) => (
                  <Link key={w.module_id} href={`/modules/${w.module_id}`} className="block">
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="truncate">{w.title}</span>
                      <span className="tabular-nums text-warning">{pct(w.accuracy)}</span>
                    </div>
                    <ProgressBar value={w.accuracy * 100} tone="warning" />
                  </Link>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Projects" />
            <div className="grid grid-cols-3 gap-2 px-5 pb-5 text-center">
              <div>
                <p className="text-xl font-semibold tabular-nums">{data.pending_projects.length}</p>
                <p className="text-[11px] text-fg-3">Active</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums">{data.capstones.started}</p>
                <p className="text-[11px] text-fg-3">Capstones started</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums">
                  {data.capstones.completed}/{data.capstones.total}
                </p>
                <p className="text-[11px] text-fg-3">Capstones done</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
