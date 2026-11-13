"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";
import type { CurriculumStage } from "@/lib/types";
import { Badge, Card, ErrorState, PageHeader, PageSkeleton, ProgressBar } from "@/components/ui";

export default function PathsPage() {
  const { base, data: course } = useCoursePage();
  const { data, error, loading, reload } = useApi<CurriculumStage[]>(`${base}/curriculum`);
  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const currentId = data.find((s) => s.modules.some((m) => !m.state.complete))?.id;
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Learning paths"
        title={course ? `${data.length} ${data.length === 1 ? "stage" : "stages"} to mastering ${course.subject}` : "Learning path"}
        description="Each stage builds on the previous one, and modules list the prerequisites they rely on."
      />
      <ol className="relative space-y-4 before:absolute before:left-[19px] before:top-4 before:bottom-4 before:w-px before:bg-border">
        {data.map((s) => {
          const lessons = s.modules.flatMap((m) => m.lessons);
          const done = lessons.filter((l) => ["completed", "mastered", "needs_revision"].includes(l.status)).length;
          const hours = s.modules.reduce((a, m) => a + m.hours, 0);
          const current = s.id === currentId;
          return (
            <li key={s.id} className="relative pl-12">
              <span className={`absolute left-2 top-5 flex size-6 items-center justify-center rounded-full border text-xs font-semibold ${current ? "border-accent bg-accent text-white" : done === lessons.length ? "border-success bg-success-soft text-success" : "border-border bg-surface text-fg-3"}`}>
                {s.order}
              </span>
              <Link href={`${base}/paths/${s.id}`} className="group block">
                <Card className="p-5 transition-colors group-hover:border-border-strong">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold group-hover:text-accent-text">{s.title}</h2>
                    {current && <Badge tone="accent">Current stage</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-fg-2">{s.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.modules.map((m) => (
                      <Badge key={m.id} tone={m.state.complete ? "success" : m.state.started ? "info" : "neutral"}>
                        {m.title}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <ProgressBar value={lessons.length ? (done / lessons.length) * 100 : 0} className="max-w-sm" label={`${s.title} progress`} />
                    <span className="text-xs tabular-nums text-fg-3">
                      {done}/{lessons.length} lessons · ~{Math.round(hours)}h
                    </span>
                    <ArrowRight className="ml-auto size-4 text-fg-3 group-hover:text-accent" />
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
