"use client";

import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, CardHeader, ErrorState, PageHeader, PageSkeleton, ProgressBar, STATUS_META, Stat, StatusBadge, Tabs, pct } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";
import type { LessonBrief, ModuleState, Status } from "@/lib/types";

interface Analytics {
  modules: (ModuleState & { id: string; title: string; stage: number })[];
  lessons: (LessonBrief & { quiz_best: number | null; minutes_spent: number })[];
  status_counts: Record<Status, number>;
  study: { day: string; minutes: number }[];
  weak_areas: { module_id: string; title: string; accuracy: number; attempts: number }[];
  skills: { module_id: string; module: string; topics: string[] }[];
  streak: number;
  longest_streak: number;
  completed: number;
  total: number;
}

const axis = { fontSize: 11, fill: "var(--text-3)" };

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-[var(--shadow-lg)]">
      <p className="text-fg-3">{label}</p>
      <p className="font-medium tabular-nums text-fg">{payload[0].value}{unit}</p>
    </div>
  );
}

export default function ProgressPage() {
  const { base } = useCoursePage();
  const { data, error, loading, reload } = useApi<Analytics>(`${base}/analytics`);
  const [view, setView] = useState<"chart" | "table">("chart");
  if (loading && !data) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const totalMinutes = data.study.reduce((a, d) => a + d.minutes, 0);
  const studyRows = data.study.map((d) => ({ ...d, label: new Date(d.day + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) }));
  const started = data.modules.filter((m) => m.started);

  return (
    <div className="fade-in space-y-6">
      <PageHeader
        eyebrow="Progress & analytics"
        title="How your learning is going"
        description="Completion, mastery, study time, weak areas and the syllabus topics you have covered."
        actions={<Tabs value={view} onChange={setView} items={[{ value: "chart", label: "Charts" }, { value: "table", label: "Tables" }]} />}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Lessons completed" value={`${data.completed}/${data.total}`} hint={`${Math.round((100 * data.completed) / Math.max(1, data.total))}% of the curriculum`} />
        <Stat label="Study time, last 30 days" value={`${(totalMinutes / 60).toFixed(1)}h`} hint={`${Math.round(totalMinutes / 30)} min/day average`} />
        <Stat label="Current streak" value={`${data.streak}d`} hint={`Longest ${data.longest_streak}d`} />
        <Stat label="Syllabus topics covered" value={data.skills.reduce((a, s) => a + s.topics.length, 0)} hint="From completed lessons" />
      </div>

      <Card>
        <CardHeader title="Lesson status" subtitle="Across the whole curriculum" />
        <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-5">
          {(Object.keys(STATUS_META) as Status[]).map((s) => (
            <div key={s} className="rounded-lg border border-border p-3">
              <StatusBadge status={s} />
              <p className="mt-2 text-xl font-semibold tabular-nums">{data.status_counts[s]}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Study minutes per day" subtitle="Last 30 days" />
          <div className="px-3 pb-4">
            {view === "chart" ? (
              <div className="h-56" role="img" aria-label={`Bar chart of study minutes per day; total ${Math.round(totalMinutes)} minutes`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={studyRows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={6} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip unit=" min" />} />
                    <Bar dataKey="minutes" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto px-2 scrollbar-thin">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-fg-3"><th className="py-1">Day</th><th className="py-1 text-right">Minutes</th></tr></thead>
                  <tbody>{[...studyRows].reverse().map((d) => <tr key={d.day} className="border-t border-border"><td className="py-1">{d.label}</td><td className="py-1 text-right tabular-nums">{d.minutes}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Mastery by module" subtitle="Average lesson mastery in modules you've started" />
          <div className="px-5 pb-5">
            {started.length === 0 ? (
              <p className="text-sm text-fg-3">Start a module to see mastery here.</p>
            ) : (
              <ul className="space-y-3">
                {started.map((m) => (
                  <li key={m.id}>
                    <Link href={`/modules/${m.id}`} className="block">
                      <div className="mb-1 flex justify-between gap-3 text-sm">
                        <span className="truncate">{m.title}</span>
                        <span className="shrink-0 tabular-nums text-fg-3">{pct(m.mastery)} · {m.completed}/{m.total}</span>
                      </div>
                      <ProgressBar value={m.mastery * 100} tone={m.complete ? "success" : "accent"} label={`${m.title} mastery`} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Weak areas" subtitle="Modules where your answers average below 70% (at least 3 attempts)" />
          <div className="space-y-3 px-5 pb-5">
            {data.weak_areas.length === 0 ? <p className="text-sm text-fg-3">None detected. Keep answering questions to sharpen this signal.</p> : data.weak_areas.map((w) => (
              <Link key={w.module_id} href={`/modules/${w.module_id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm hover:bg-surface-2">
                <span className="truncate">{w.title}</span>
                <span className="shrink-0 text-xs text-fg-3"><span className="font-medium text-warning">{pct(w.accuracy)}</span> over {w.attempts} answers</span>
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Topics covered" subtitle="Syllabus topics from lessons you have completed, by module" />
          <div className="space-y-3 px-5 pb-5">
            {data.skills.length === 0 ? <p className="text-sm text-fg-3">Complete lessons to cover syllabus topics.</p> : data.skills.map((s) => (
              <div key={s.module_id}>
                <p className="text-xs font-medium text-fg-3">{s.module}</p>
                <div className="mt-1 flex flex-wrap gap-1">{s.topics.map((t) => <Badge key={t} tone="success">{t}</Badge>)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Lessons you've started" />
        <div className="overflow-x-auto px-5 pb-5">
          {data.lessons.length === 0 ? <p className="text-sm text-fg-3">No lessons started yet.</p> : (
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-fg-3"><th className="py-2">Lesson</th><th>Status</th><th className="text-right">Best quiz</th><th className="text-right">Mastery</th><th className="text-right">Time</th></tr></thead>
              <tbody>
                {data.lessons.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-2 pr-3"><Link href={`/lessons/${l.id}`} className="hover:text-accent-text">{l.title}</Link></td>
                    <td><StatusBadge status={l.status} /></td>
                    <td className="text-right tabular-nums">{pct(l.quiz_best)}</td>
                    <td className="text-right tabular-nums">{pct(l.mastery)}</td>
                    <td className="text-right tabular-nums text-fg-3">{l.minutes_spent} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
