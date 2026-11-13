"use client";

import { useMemo, useState } from "react";
import { ModuleCard } from "@/components/module-card";
import { ErrorState, PageHeader, PageSkeleton, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";
import { CoverageCard } from "@/components/course-bits";
import type { CurriculumStage } from "@/lib/types";

type Filter = "all" | "active" | "authored";

export default function CurriculumPage() {
  const { base, data: course } = useCoursePage();
  const { data, error, loading, reload } = useApi<CurriculumStage[]>(`${base}/curriculum`);
  const [filter, setFilter] = useState<Filter>("all");
  const titles = useMemo(() => Object.fromEntries((data ?? []).flatMap((s) => s.modules.map((m) => [m.id, m.title]))), [data]);
  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const lessons = data.flatMap((s) => s.modules.flatMap((m) => m.lessons));
  let n = 0;
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Curriculum"
        title={course?.title ?? "Curriculum"}
        description={`${data.length} stages · ${data.reduce((a, s) => a + s.modules.length, 0)} modules · ${lessons.length} lessons. Modules list their prerequisites, and the order respects them.`}
        actions={<Tabs value={filter} onChange={setFilter} items={[{ value: "all", label: "All" }, { value: "active", label: "In progress" }, { value: "authored", label: "Written lessons" }]} />}
      />
      <CoverageCard base={base} />
      <div className="mt-8 space-y-10">
        {data.map((stage) => {
          const mods = stage.modules.filter((m) =>
            filter === "all" ? true : filter === "active" ? m.state.started && !m.state.complete : m.lessons.some((l) => l.content_status === "authored"),
          );
          const offset = n;
          n += stage.modules.length;
          if (mods.length === 0) return null;
          return (
            <section key={stage.id} aria-labelledby={`stage-${stage.id}`}>
              <div className="mb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-3">Stage {stage.order}</p>
                <h2 id={`stage-${stage.id}`} className="text-lg font-semibold">
                  {stage.title}
                </h2>
                <p className="mt-0.5 max-w-3xl text-sm text-fg-2">{stage.summary}</p>
              </div>
              <div className="space-y-3">
                {mods.map((m) => (
                  <ModuleCard key={m.id} mod={m} index={offset + stage.modules.indexOf(m) + 1} titles={titles} defaultOpen={m.state.started && !m.state.complete} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
