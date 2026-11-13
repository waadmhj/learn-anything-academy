"use client";

import { Flame, Layers, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { PinnedNotes } from "@/components/annotations/notebook-item";
import { CourseCard } from "@/components/course-bits";
import { ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { Course, NotebookEntry } from "@/lib/types";

interface Home {
  user: { name: string; daily_goal_minutes: number };
  due_cards: number;
  streak: number;
  longest_streak: number;
  ai: boolean;
}

export default function HomePage() {
  const courses = useApi<Course[]>("/courses");
  const home = useApi<Home>("/home");
  const { data: pinned } = useApi<NotebookEntry[]>("/notebook?pinned=true");
  const building = courses.data?.some((c) => c.status === "building");
  const { reload } = courses;
  useEffect(() => {
    if (!building) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [building, reload]);

  if ((courses.loading && !courses.data) || (home.loading && !home.data)) return <PageSkeleton />;
  if (courses.error) return <ErrorState error={courses.error} onRetry={courses.reload} />;
  const list = courses.data ?? [];
  const h = home.data;
  return (
    <div className="fade-in space-y-6">
      <PageHeader
        eyebrow="Learn Anything Academy"
        title={h ? `Hi ${h.user.name}, what do you want to learn?` : "What do you want to learn?"}
        description="Give it a subject and, if you have one, your syllabus or notes. You get a structured course: stages, modules and lessons in the right order, the best-rated material from Hacker News, books and research, quizzes, flashcards and projects."
        actions={<ButtonLink href="/new" variant="primary"><Plus className="size-4" /> New course</ButtonLink>}
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-6" />}
          title="No courses yet"
          action={<ButtonLink href="/new" variant="primary"><Plus className="size-4" /> Create your first course</ButtonLink>}
        >
          Try “Linear algebra for machine learning”, “Conversational Spanish”, “Music theory” or paste a university syllabus.
        </EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="grid content-start gap-4 md:grid-cols-2 xl:col-span-2">
            {list.map((c) => (
              <CourseCard key={c.id} c={c} />
            ))}
          </div>
          <div className="space-y-6">
            {h && (
              <Card>
                <CardHeader title="Today" />
                <div className="grid grid-cols-2 gap-3 px-5 pb-5">
                  <Link href="/flashcards" className="rounded-lg border border-border p-3 hover:bg-surface-2">
                    <Layers className="size-4 text-fg-3" />
                    <p className="mt-2 text-2xl font-semibold tabular-nums">{h.due_cards}</p>
                    <p className="text-xs text-fg-3">flashcards due</p>
                  </Link>
                  <div className="rounded-lg border border-border p-3">
                    <Flame className="size-4 text-fg-3" />
                    <p className="mt-2 text-2xl font-semibold tabular-nums">{h.streak}</p>
                    <p className="text-xs text-fg-3">day streak (best {h.longest_streak})</p>
                  </div>
                </div>
              </Card>
            )}
            {pinned && pinned.length > 0 && (
              <Card>
                <CardHeader title="Pinned notes" action={<Link href="/notebook" className="text-xs text-accent-text hover:underline">Notebook</Link>} />
                <PinnedNotes entries={pinned} />
              </Card>
            )}
            {h && !h.ai && (
              <Card className="p-4 text-xs text-fg-3">
                AI isn&apos;t set up on this server. Courses are built from your syllabus (or the subject&apos;s standard structure) with real resources, and lessons are guided outlines.
                Add <code className="rounded bg-surface-2 px-1">ANTHROPIC_API_KEY</code> to the API for full written lessons, quizzes and a tutor.
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
