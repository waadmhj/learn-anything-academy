"use client";

import { Pin } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "../ui";
import { dotVar } from "./palette";
import { keyOf, type AnnotationsApi } from "./use-annotations";

/** Jump to an annotation on the current lesson page (the layer listens for #ann-<id>). */
export function openAnnotation(id: number) {
  const hash = `#ann-${id}`;
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

/** "Your notes" list for the lesson sidebar. */
export function LessonNotesPanel({ ann, orphans }: { ann: AnnotationsApi; orphans: number[] }) {
  const list = ann.items.filter((a) => a.kind !== "ink");
  const ink = ann.items.length - list.length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-3">Your notes</p>
        <Link href="/notebook" className="text-xs text-accent-text hover:underline">Notebook</Link>
      </div>
      {!ann.loaded ? (
        <Skeleton className="h-12" />
      ) : list.length === 0 && ink === 0 ? (
        <p className="text-[13px] leading-snug text-fg-3">
          Select text to highlight it, or press <kbd className="rounded border border-border px-1 font-mono text-[11px]">N</kbd> and click to add a sticky note.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((a) => (
            <li key={keyOf(a)}>
              <button
                onClick={() => openAnnotation(a.id)}
                disabled={a.id < 0}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-left text-[13px] hover:bg-surface-2"
              >
                <span className="flex items-start gap-2">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: dotVar(a.color) }} />
                  <span className="min-w-0 flex-1">
                    {a.kind === "highlight" && <span className="line-clamp-2 italic text-fg-2">“{a.data.quote}”</span>}
                    {a.text ? (
                      <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap text-fg">{a.text}</span>
                    ) : (
                      a.kind === "note" && <span className="text-fg-3">Empty note</span>
                    )}
                    {orphans.includes(a.id) && <span className="mt-0.5 block text-[11px] text-warning">The lesson text changed, so this passage can&apos;t be found on the page.</span>}
                  </span>
                  {a.pinned && <Pin className="mt-0.5 size-3 shrink-0 fill-current text-accent" aria-label="Pinned" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ink > 0 && <p className="mt-2 text-xs text-fg-3">{ink} pen {ink === 1 ? "stroke" : "strokes"} on this page</p>}
    </div>
  );
}
