"use client";

import { Layers, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useStudyTimer } from "@/components/lesson-parts";
import { Markdown } from "@/components/markdown";
import { Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, ProgressBar, Stat, pct } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { FlashcardItem } from "@/lib/types";

interface Stats {
  total: number;
  due: number;
  new: number;
  mature: number;
  retention: number | null;
  next_7_days: number[];
  lapsed: number;
}

const GRADES = [
  { g: 0, label: "Again", hint: "<10m", key: "1", cls: "border-danger/40 hover:bg-danger-soft" },
  { g: 1, label: "Hard", hint: "", key: "2", cls: "border-warning/40 hover:bg-warning-soft" },
  { g: 2, label: "Good", hint: "", key: "3", cls: "border-success/40 hover:bg-success-soft" },
  { g: 3, label: "Easy", hint: "", key: "4", cls: "border-info/40 hover:bg-info-soft" },
];

export default function FlashcardsPage() {
  const stats = useApi<Stats>("/flashcards/stats");
  const due = useApi<FlashcardItem[]>("/flashcards/due?limit=50");
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useStudyTimer();
  const cards = due.data ?? [];
  const card = cards[i];

  const grade = async (g: number) => {
    if (!card) return;
    setErr(null);
    try {
      await api(`/flashcards/${encodeURIComponent(card.id)}/review`, { method: "POST", json: { grade: g } });
      setReviewed((r) => r + 1);
      setFlipped(false);
      setI((x) => x + 1);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) grade(Number(e.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if ((stats.loading && !stats.data) || (due.loading && !due.data)) return <PageSkeleton />;
  if (stats.error || due.error) return <ErrorState error={stats.error ?? due.error} onRetry={() => { stats.reload(); due.reload(); }} />;
  const s = stats.data!;
  const finished = cards.length > 0 && i >= cards.length;

  return (
    <div className="fade-in">
      <PageHeader eyebrow="Knowledge retention" title="Flashcards" description="Spaced repetition (SM-2): cards you know come back less and less often, and cards you miss come back soon. Each lesson's cards join your deck after its knowledge check." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Due now" value={s.due} />
        <Stat label="In deck" value={s.total} hint={`${s.new} new · ${s.mature} mature (≥21 days)`} />
        <Stat label="Retention" value={pct(s.retention)} hint="Correct reviews / all reviews" />
        <Stat label="Next 7 days" value={s.next_7_days.reduce((a, b) => a + b, 0)} hint={s.next_7_days.join(" · ")} />
      </div>

      {s.total === 0 ? (
        <EmptyState icon={<Layers className="size-6" />} title="Your deck is empty" action={<ButtonLink href="/curriculum" variant="primary">Go to curriculum</ButtonLink>}>
          Complete a lesson&apos;s knowledge check to add its flashcards.
        </EmptyState>
      ) : cards.length === 0 || finished ? (
        <EmptyState icon={<RotateCcw className="size-6" />} title={finished ? `Session complete: ${reviewed} cards reviewed` : "Nothing due right now"} action={finished ? <Button onClick={() => { setI(0); setReviewed(0); due.reload(); stats.reload(); }}>Check for more</Button> : undefined}>
          Come back later. Your next reviews are already scheduled.
        </EmptyState>
      ) : (
        <div className="mx-auto max-w-2xl">
          <div className="mb-3 flex items-center gap-3">
            <ProgressBar value={(i / cards.length) * 100} label="Session progress" />
            <span className="text-xs tabular-nums text-fg-3">{i + 1}/{cards.length}</span>
          </div>
          <Card className="min-h-64 p-6 sm:p-8">
            <Link href={`/lessons/${card.lesson_id}`} className="text-xs text-fg-3 hover:underline">{card.lesson_title}</Link>
            <Markdown className="mt-3 text-lg font-medium">{card.front}</Markdown>
            {flipped ? (
              <div className="mt-6 border-t border-border pt-6 fade-in">
                <Markdown>{card.back}</Markdown>
              </div>
            ) : (
              <p className="mt-8 text-sm text-fg-3">Recall the answer in your head, then reveal it.</p>
            )}
          </Card>
          <div className="mt-4">
            {!flipped ? (
              <Button variant="primary" className="w-full" onClick={() => setFlipped(true)}>Show answer <kbd className="ml-2 text-[10px] opacity-70">Space</kbd></Button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {GRADES.map((b) => (
                  <button key={b.g} onClick={() => grade(b.g)} className={`rounded-lg border bg-surface px-2 py-2.5 text-sm font-medium ${b.cls}`}>
                    {b.label}
                    <span className="block text-[10px] font-normal text-fg-3">key {b.key}{b.hint && ` · ${b.hint}`}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        </div>
      )}
    </div>
  );
}
