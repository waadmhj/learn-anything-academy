"use client";

import { FileUp, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Card, PageHeader } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Course } from "@/lib/types";

const field = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none";
const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.rst,.tex,.csv";

export default function NewCoursePage() {
  const router = useRouter();
  const { data: ai } = useApi<{ available: boolean }>("/ai/status");
  const [subject, setSubject] = useState("");
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState("beginner");
  const [hours, setHours] = useState(5);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (subject.trim().length < 2) {
      setErr("Name the subject you want to learn.");
      return;
    }
    if (file && file.size > 15 * 1024 * 1024) {
      setErr("Files can be up to 15 MB.");
      return;
    }
    setBusy(true);
    setErr(null);
    const form = new FormData();
    form.set("subject", subject.trim());
    form.set("goal", goal.trim());
    form.set("level", level);
    form.set("hours_per_week", String(hours));
    form.set("text", text);
    if (file) form.set("file", file);
    try {
      const c = await api<Course>("/courses", { method: "POST", body: form });
      router.push(`/courses/${c.id}`);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fade-in">
      <PageHeader eyebrow="New course" title="What do you want to learn?" description="The more you tell me, the better the course fits. Only the subject is required." />
      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5">
        <Card className="space-y-4 p-5">
          <div>
            <label htmlFor="subject" className="text-sm font-medium">Subject</label>
            <input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required autoFocus className={`${field} mt-1.5`} placeholder="e.g. Organic chemistry, Japanese for travel, Kubernetes, Renaissance art" />
          </div>
          <div>
            <label htmlFor="goal" className="text-sm font-medium">Your goal <span className="font-normal text-fg-3">(optional)</span></label>
            <textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={2000} rows={2} className={`${field} mt-1.5`} placeholder="e.g. Pass my second-year exam in June · Hold a 10-minute conversation · Deploy my own cluster" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="level" className="text-sm font-medium">Your level</label>
              <select id="level" value={level} onChange={(e) => setLevel(e.target.value)} className={`${field} mt-1.5`}>
                <option value="beginner">Beginner: new to this</option>
                <option value="intermediate">Intermediate: know the basics</option>
                <option value="advanced">Advanced: going deep</option>
              </select>
            </div>
            <div>
              <label htmlFor="hours" className="text-sm font-medium">Hours per week</label>
              <input id="hours" type="number" min={1} max={80} value={hours} onChange={(e) => setHours(Math.max(1, Math.min(80, Number(e.target.value) || 1)))} className={`${field} mt-1.5`} />
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <p className="text-sm font-medium">Syllabus or material <span className="font-normal text-fg-3">(optional)</span></p>
            <p className="mt-0.5 text-xs text-fg-3">
              Paste a syllabus, table of contents or your notes, or upload a PDF, Word or Markdown file. Every topic in it becomes part of the course.
              {ai && !ai.available && " Without AI, headings become modules and the items under them become lessons."}
            </p>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            aria-label="Syllabus text"
            className={`${field} font-mono text-[13px]`}
            placeholder={"# Week 1: Foundations\n- Topic one\n- Topic two\n\n# Week 2: …"}
          />
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              <FileUp className="size-4" /> {file ? "Change file" : "Upload a file"}
            </Button>
            {file && (
              <span className="inline-flex items-center gap-1.5 text-sm text-fg-2">
                {file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)
                <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} className="rounded p-0.5 hover:bg-surface-2" aria-label="Remove file">
                  <X className="size-3.5" />
                </button>
              </span>
            )}
            <span className="text-xs text-fg-3">PDF, Word, Markdown or text, up to 15 MB</span>
          </div>
        </Card>

        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-fg-3">
            {ai?.available ? "Claude plans the course and writes your first lesson; the rest are written as you go." : "Building takes about a minute."}
          </p>
          <Button type="submit" variant="primary" loading={busy}>
            <Sparkles className="size-4" /> Build my course
          </Button>
        </div>
      </form>
    </div>
  );
}
