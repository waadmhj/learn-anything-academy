"use client";

import { ChevronDown, Lock, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { CurriculumModule } from "@/lib/types";
import { LessonStatusBadge } from "./course-bits";
import { Badge, ProgressBar, StatusDot, cn } from "./ui";

export function ModuleCard({ mod, index, defaultOpen = false, titles }: { mod: CurriculumModule; index: number; defaultOpen?: boolean; titles: Record<string, string> }) {
  const [open, setOpen] = useState(defaultOpen);
  const s = mod.state;
  const p = s.total ? (s.completed / s.total) * 100 : 0;
  return (
    <div className="rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-4 p-4 text-left">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold", s.complete ? "bg-success-soft text-success" : s.started ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-fg-3")}>
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold">{mod.title}</h3>
            {!mod.prerequisites_met && (
              <Badge tone="warning">
                <Lock className="size-3" /> Prerequisites first
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-fg-2">{mod.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-3">
            <span>{mod.lessons.length} lessons</span>
            <span>~{mod.hours}h</span>
            {mod.prerequisites.length > 0 && <span>Requires: {mod.prerequisites.map((id) => titles[id] ?? id).join(", ")}</span>}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar value={p} tone={s.complete ? "success" : "accent"} className="max-w-xs" label={`${mod.title} progress`} />
            <span className="text-xs tabular-nums text-fg-3">
              {s.completed}/{s.total}
            </span>
          </div>
        </div>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-fg-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border px-2 py-2">
          <ol>
            {mod.lessons.map((l, i) => (
              <li key={l.id}>
                <Link href={`/lessons/${l.id}`} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-2">
                  <span className="w-5 text-right text-xs tabular-nums text-fg-3">{i + 1}</span>
                  <StatusDot status={l.status} />
                  <span className="min-w-0 flex-1 truncate text-sm group-hover:text-accent-text">{l.title}</span>
                  <LessonStatusBadge status={l.content_status} />
                  <span className="hidden w-14 text-right text-xs text-fg-3 sm:block">{l.minutes} min</span>
                </Link>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-1 pt-2">
            <Link href={`/modules/${mod.id}`} className="text-xs font-medium text-accent-text hover:underline">
              Module overview →
            </Link>
            {mod.project_id && (
              <Link href={`/projects/${mod.project_id}`} className="inline-flex items-center gap-1 text-xs text-fg-2 hover:text-fg">
                <Wrench className="size-3" /> Module project
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
