"use client";

import { Clock, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";
import type { ProjectSummary } from "@/lib/types";
import { Badge, Card, ErrorState, PageHeader, PageSkeleton, ProgressBar, Tabs } from "@/components/ui";

const LEVELS = [
  { value: "all", label: "All" },
  { value: "mini", label: "Mini" },
  { value: "module", label: "Module" },
  { value: "capstone", label: "Capstones" },
] as const;

const LEVEL_INFO: Record<ProjectSummary["level"], { label: string; tone: "neutral" | "info" | "accent" | "mastered" }> = {
  mini: { label: "Level 1 · Mini", tone: "neutral" },
  module: { label: "Level 2 · Module", tone: "info" },
  capstone: { label: "Level 3 · Capstone", tone: "accent" },
  portfolio: { label: "Final · Portfolio", tone: "mastered" },
};
const STATUS_TONE = { not_started: "neutral", in_progress: "info", submitted: "warning", completed: "success" } as const;

export default function ProjectsPage() {
  const { base } = useCoursePage();
  const { data, error, loading, reload } = useApi<ProjectSummary[]>(`${base}/projects`);
  const [level, setLevel] = useState<(typeof LEVELS)[number]["value"]>("all");
  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const shown = data.filter((p) => level === "all" || p.level === level || (level === "capstone" && p.level === "portfolio"));
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Projects"
        title="Build it, don't just study it"
        description="Practice what you learn: mini projects along the way and a capstone that brings the whole course together. Capstones ask for evidence at each milestone, key decisions and a self-assessment."
        actions={<Tabs value={level} onChange={setLevel} items={LEVELS.map((l) => ({ value: l.value, label: l.label }))} />}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="group">
            <Card className="flex h-full flex-col p-5 transition-colors group-hover:border-border-strong">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={LEVEL_INFO[p.level].tone}>{LEVEL_INFO[p.level].label}</Badge>
                {p.status !== "not_started" && <Badge tone={STATUS_TONE[p.status]}>{p.status.replace("_", " ")}</Badge>}
                {!p.ready && p.status === "not_started" && (
                  <Badge tone="warning">
                    <Lock className="size-3" /> After prerequisites
                  </Badge>
                )}
              </div>
              <h2 className="mt-3 font-semibold group-hover:text-accent-text">{p.title}</h2>
              <p className="mt-1 flex-1 text-sm text-fg-2">{p.summary}</p>
              <div className="mt-4 space-y-2">
                <ProgressBar value={p.milestones ? (p.milestones_done / p.milestones) * 100 : 0} tone={p.status === "completed" ? "success" : "accent"} label="Milestones" />
                <div className="flex justify-between text-xs text-fg-3">
                  <span>{p.milestones_done}/{p.milestones} {p.level === "mini" || p.level === "module" ? "requirements" : "milestones"}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="size-3" /> ~{p.hours}h</span>
                </div>
                {p.module_title && <p className="text-xs text-fg-3">Module: {p.module_title}</p>}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
