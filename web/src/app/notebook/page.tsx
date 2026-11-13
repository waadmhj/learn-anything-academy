"use client";

import { NotebookPen, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NotebookItem } from "@/components/annotations/notebook-item";
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { NotebookEntry } from "@/lib/types";

type Tab = "all" | "pinned" | "highlight" | "note";

export default function NotebookPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const params = new URLSearchParams({ kind: tab === "highlight" || tab === "note" ? tab : "all", pinned: String(tab === "pinned"), q: query });
  const { data, error, loading, reload, setData } = useApi<NotebookEntry[]>(`/notebook?${params}`);

  const pin = async (e: NotebookEntry) => {
    setData((xs) => xs?.map((x) => (x.id === e.id ? { ...x, pinned: !e.pinned } : x)) ?? xs);
    try {
      await api(`/annotations/${e.id}`, { method: "PATCH", json: { pinned: !e.pinned } });
      if (tab === "pinned") reload();
    } catch (err) {
      setToast({ msg: `Couldn't save: ${(err as Error).message}` });
      reload();
    }
  };

  const remove = async (e: NotebookEntry) => {
    setData((xs) => xs?.filter((x) => x.id !== e.id) ?? xs);
    try {
      await api(`/annotations/${e.id}`, { method: "DELETE" });
      setToast({
        msg: e.kind === "highlight" ? "Highlight deleted" : "Note deleted",
        undo: async () => {
          await api(`/lessons/${e.lesson_id}/annotations`, { method: "POST", json: { kind: e.kind, color: e.color, text: e.text, pinned: e.pinned, data: e.data } }).catch(() => {});
          reload();
        },
      });
    } catch (err) {
      setToast({ msg: `Couldn't delete: ${(err as Error).message}` });
      reload();
    }
  };

  // Group by lesson, keeping the server order (pinned first, then most recently edited).
  const groups: { lesson_id: string; lesson_title: string; module_title: string; items: NotebookEntry[] }[] = [];
  for (const e of data ?? []) {
    let g = groups.find((x) => x.lesson_id === e.lesson_id);
    if (!g) groups.push((g = { lesson_id: e.lesson_id, lesson_title: e.lesson_title, module_title: e.module_title, items: [] }));
    g.items.push(e);
  }

  return (
    <div className="fade-in space-y-6">
      <PageHeader
        title="Notebook"
        description="Every highlight and sticky note you've made, across all lessons. Pin the important ones to keep them at the top and on your dashboard."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: "All" },
            { value: "pinned", label: "Pinned" },
            { value: "highlight", label: "Highlights" },
            { value: "note", label: "Sticky notes" },
          ]}
        />
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">Search notes</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes and highlights…"
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-sm focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<NotebookPen className="size-6" />} title={query ? "Nothing matches your search" : tab === "pinned" ? "No pinned notes yet" : "Your notebook is empty"}>
          {query
            ? "Try a different word."
            : tab === "pinned"
              ? "Use the pin button on a highlight or sticky note to keep it here."
              : "Open a lesson, select text to highlight it, or press N to add a sticky note. Everything you write shows up here."}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.lesson_id} aria-labelledby={`nb-${g.lesson_id}`}>
              <p className="text-xs text-fg-3">{g.module_title}</p>
              <h2 id={`nb-${g.lesson_id}`} className="text-base font-semibold">
                <Link href={`/lessons/${g.lesson_id}`} className="hover:text-accent-text">{g.lesson_title}</Link>
              </h2>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {g.items.map((e) => (
                  <NotebookItem key={e.id} e={e} onPin={() => pin(e)} onDelete={() => remove(e)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-fg px-3.5 py-2 text-sm text-bg shadow-[var(--shadow-lg)]">
          {toast.msg}
          {toast.undo && (
            <button
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                toast.undo!();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
