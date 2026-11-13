"use client";

import { Bot } from "lucide-react";
import { TutorChat } from "@/components/tutor-chat";
import { Card, PageHeader, PageSkeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";

export default function TutorPage() {
  const { data: course } = useCoursePage();
  const { data: ai } = useApi<{ available: boolean; model: string | null }>("/ai/status");
  if (!course) return <PageSkeleton />;
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Tutor"
        title={`Your ${course.subject} tutor`}
        description="Ask anything about this course. Answers come from your lessons, your own material and the resources' summaries, and cite where they came from."
      />
      <div className="mx-auto max-w-3xl space-y-4">
        {ai && !ai.available && (
          <Card className="flex gap-3 p-4 text-sm text-fg-2">
            <Bot className="size-5 shrink-0 text-fg-3" />
            <p>
              AI isn&apos;t set up on this server, so the tutor answers with the most relevant passages from your course instead of writing an explanation.
              Set <code className="rounded bg-surface-2 px-1">ANTHROPIC_API_KEY</code> on the API to enable full answers.
            </p>
          </Card>
        )}
        <Card className="p-5">
          <TutorChat courseId={course.id} />
        </Card>
      </div>
    </div>
  );
}
