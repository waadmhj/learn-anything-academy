"use client";

import { Pin } from "lucide-react";
import Link from "next/link";
import type { NotebookEntry } from "@/lib/types";
import { cn } from "../ui";
import { dotVar, edgeVar, noteVar } from "./palette";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function NotebookItem({ e, onPin, onDelete, compact }: { e: NotebookEntry; onPin?: () => void; onDelete?: () => void; compact?: boolean }) {
  return (
    <li className={cn("rounded-xl border border-border bg-surface", compact ? "p-3" : "p-4")}>
      {e.kind === "highlight" && (
        <blockquote className={cn("border-l-[3px] pl-3 italic text-fg-2", compact ? "line-clamp-3 text-[13px]" : "text-sm")} style={{ borderColor: dotVar(e.color) }}>
          {e.data.quote}
        </blockquote>
      )}
      {e.text ? (
        <p
          className={cn("whitespace-pre-wrap text-fg", compact ? "line-clamp-4 text-[13px]" : "text-sm", e.kind === "highlight" ? "mt-2" : "rounded-lg border p-3")}
          style={e.kind === "note" ? { background: noteVar(e.color), borderColor: edgeVar(e.color) } : undefined}
        >
          {e.text}
        </p>
      ) : (
        e.kind === "note" && <p className="text-sm text-fg-3">Empty sticky note</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
        <Link href={`/lessons/${e.lesson_id}#ann-${e.id}`} className="font-medium text-accent-text hover:underline">
          {compact ? e.lesson_title : "Open in lesson"}
        </Link>
        {!compact && <span>{e.kind === "highlight" ? "Highlight" : "Sticky note"} · {when(e.updated_at)}</span>}
        <span className="flex-1" />
        {onPin && (
          <button onClick={onPin} aria-pressed={e.pinned} className={cn("inline-flex items-center gap-1 hover:text-fg", e.pinned && "text-accent-text")}>
            <Pin className={cn("size-3", e.pinned && "fill-current")} /> {e.pinned ? "Pinned" : "Pin"}
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} className="hover:text-danger">
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

/** Dashboard card content: pinned highlights and notes, if any. */
export function PinnedNotes({ entries }: { entries: NotebookEntry[] }) {
  return (
    <ul className="space-y-2 px-5 pb-5">
      {entries.slice(0, 5).map((e) => (
        <NotebookItem key={e.id} e={e} compact />
      ))}
    </ul>
  );
}
