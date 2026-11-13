"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { ModuleCard } from "@/components/module-card";
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";
import type { CurriculumStage } from "@/lib/types";

export default function StagePage({ params }: { params: Promise<{ stageId: string }> }) {
  const { stageId } = use(params);
  const { base } = useCoursePage();
  const { data, error, loading, reload } = useApi<CurriculumStage[]>(`${base}/curriculum`);
  const titles = useMemo(() => Object.fromEntries((data ?? []).flatMap((s) => s.modules.map((m) => [m.id, m.title]))), [data]);
  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const stage = data?.find((s) => s.id === stageId);
  if (!data || !stage) return <EmptyState title="Stage not found" action={<Link href={`${base}/paths`} className="text-sm text-accent-text">Back to learning path</Link>} />;
  const offset = data.filter((s) => s.order < stage.order).reduce((a, s) => a + s.modules.length, 0);
  const firstOpen = stage.modules.find((m) => !m.state.complete)?.id;
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={
          <>
            <Link href={`${base}/paths`} className="hover:text-fg">Learning path</Link> / Stage {stage.order}
          </>
        }
        title={stage.title}
        description={stage.summary}
      />
      <div className="space-y-3">
        {stage.modules.map((m, i) => (
          <ModuleCard key={m.id} mod={m} index={offset + i + 1} titles={titles} defaultOpen={m.id === firstOpen} />
        ))}
      </div>
    </div>
  );
}
