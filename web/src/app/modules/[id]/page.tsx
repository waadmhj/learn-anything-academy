"use client";

import { AlertTriangle, CheckCircle2, Wrench } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { LessonStatusBadge } from "@/components/course-bits";
import { useApi } from "@/lib/api";
import { useMarkCourse } from "@/lib/course";
import type { Course, ModuleDetail } from "@/lib/types";
import { Badge, ButtonLink, Card, ErrorState, PageHeader, PageSkeleton, ProgressBar, StatusBadge, levelTone, pct } from "@/components/ui";

export default function ModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useApi<ModuleDetail>(`/modules/${id}`);
  const { data: course } = useApi<Course>(data ? `/courses/${data.course_id}` : null);
  useMarkCourse(course);
  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.state;
  const next = data.lessons.find((l) => !["completed", "mastered"].includes(l.status));
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={
          <>
            {course && <><Link href={`/courses/${course.id}`} className="hover:text-fg">{course.title}</Link> / </>}
            <Link href={`/courses/${data.course_id}/paths/${data.stage.id}`} className="hover:text-fg">Stage {data.stage.order} · {data.stage.title}</Link>
          </>
        }
        title={data.title}
        description={data.summary}
        actions={next && <ButtonLink href={`/lessons/${next.id}`} variant="primary">{s.started ? "Continue module" : "Start module"}</ButtonLink>}
      />

      {!data.prerequisites_met && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-warning">Recommended prerequisites aren&apos;t complete yet</p>
            <p className="mt-0.5 text-fg-2">
              You can explore this module now, but it assumes knowledge from:{" "}
              {data.prerequisites.filter((p) => !p.complete).map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link className="underline" href={`/modules/${p.id}`}>{p.title}</Link>
                </span>
              ))}
              .
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {data.lessons.map((l, i) => (
            <Link key={l.id} href={`/lessons/${l.id}`} className="group block">
              <Card className="p-4 transition-colors group-hover:border-border-strong">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-6 text-sm tabular-nums text-fg-3">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium group-hover:text-accent-text">{l.title}</h3>
                      <StatusBadge status={l.status} />
                      <LessonStatusBadge status={l.content_status} />
                    </div>
                    <ul className="mt-2 space-y-0.5 text-sm text-fg-2">
                      {l.objectives.map((o) => (
                        <li key={o} className="flex gap-2">
                          <span className="text-fg-3">•</span>
                          {o}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-3">
                      <Badge tone={levelTone(l.level)}>{l.level}</Badge>
                      <span>{l.minutes} min</span>
                      <span>{l.content_status === "authored" ? "Written lesson with practice and a knowledge check" : "Outline with the best-rated resources"}</span>
                      {l.mastery > 0 && <span>Mastery {pct(l.mastery)}</span>}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <p className="text-sm font-medium">Module progress</p>
            <div className="mt-3 flex items-center gap-3">
              <ProgressBar value={s.total ? (s.completed / s.total) * 100 : 0} tone={s.complete ? "success" : "accent"} />
              <span className="text-xs tabular-nums text-fg-3">{s.completed}/{s.total}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-fg-3">Mastered</dt>
                <dd className="font-semibold tabular-nums">{s.mastered}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-3">Avg. mastery</dt>
                <dd className="font-semibold tabular-nums">{pct(s.mastery)}</dd>
              </div>
            </dl>
          </Card>
          {data.prerequisites.length > 0 && (
            <Card className="p-5">
              <p className="text-sm font-medium">Prerequisites</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {data.prerequisites.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    {p.complete ? <CheckCircle2 className="size-4 text-success" /> : <span className="size-4 rounded-full border border-border-strong" />}
                    <Link href={`/modules/${p.id}`} className="hover:underline">{p.title}</Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.project && (
            <Card className="p-5">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Wrench className="size-4 text-fg-3" /> Module project
              </p>
              <Link href={`/projects/${data.project.id}`} className="mt-2 block font-medium text-accent-text hover:underline">{data.project.title}</Link>
              <p className="mt-1 text-sm text-fg-2">{data.project.summary}</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
