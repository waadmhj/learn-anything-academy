"use client";

import { Bot, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Markdown } from "./markdown";
import { Button, cn } from "./ui";

interface TutorAnswer {
  ok: boolean;
  error?: string;
  answer?: string;
  sources?: { doc_id: string; title: string; excerpt: string }[];
  used_llm?: boolean;
}

interface Turn {
  q: string;
  a: TutorAnswer;
}

const MODES = [
  { id: "ask", label: "Ask" },
  { id: "simpler", label: "Explain simpler" },
  { id: "example", label: "Another example" },
  { id: "exercise", label: "Make an exercise" },
  { id: "quiz", label: "Quiz me" },
  { id: "connect", label: "How it connects" },
] as const;

export function TutorChat({ courseId, lessonId, compact }: { courseId: number; lessonId?: string; compact?: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("ask");
  const [scope, setScope] = useState<"lesson" | "course">(lessonId ? "lesson" : "course");
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const question = q.trim();
    if (question.length < 3) return;
    setBusy(true);
    try {
      const a = await api<TutorAnswer>(`/courses/${courseId}/tutor/ask`, { method: "POST", json: { question, lesson_id: lessonId ?? null, scope, mode } });
      setTurns((t) => [...t, { q: question, a }]);
      setQ("");
    } catch (e) {
      setTurns((t) => [...t, { q: question, a: { ok: false, error: (e as Error).message } }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className={cn("space-y-4 overflow-y-auto scrollbar-thin", compact ? "max-h-96" : "max-h-[60vh]")} aria-live="polite">
        {turns.length === 0 && (
          <p className="text-sm text-fg-3">
            Ask anything about the course. Answers are grounded in the lesson material and cite the lessons they came from.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[90%] rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent-text">{t.q}</p>
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs text-fg-3">
                <Bot className="size-3.5" /> {t.a.ok ? (t.a.used_llm ? "Written by AI from your course" : "Extract from your course (AI not set up)") : "Error"}
              </p>
              {t.a.ok ? <Markdown className="text-sm">{t.a.answer ?? ""}</Markdown> : <pre className="whitespace-pre-wrap text-xs text-danger">{t.a.error}</pre>}
              {t.a.sources && t.a.sources.length > 0 && (
                <ol className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
                  {t.a.sources.map((s, j) => (
                    <li key={j} className="flex gap-1.5">
                      <span className="text-fg-3">[{j + 1}]</span>
                      {s.doc_id.startsWith("material-") ? (
                        <span className="text-fg-2">{s.title}</span>
                      ) : (
                        <Link href={`/lessons/${s.doc_id}`} className="text-accent-text hover:underline">
                          {s.title}
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)} className={cn("rounded-md px-2 py-1 text-xs", mode === m.id ? "bg-accent-soft text-accent-text" : "text-fg-2 hover:bg-surface-2")}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          rows={2}
          placeholder="Ask your tutor…"
          aria-label="Question for the tutor"
          className="flex-1 resize-none rounded-lg border border-border bg-bg p-2.5 text-sm focus:border-accent focus:outline-none"
        />
        <Button variant="primary" onClick={ask} loading={busy} aria-label="Send" className="h-auto">
          <Send className="size-4" />
        </Button>
      </div>
      {lessonId && (
        <label className="flex items-center gap-2 text-xs text-fg-3">
          <input type="checkbox" checked={scope === "lesson"} onChange={(e) => setScope(e.target.checked ? "lesson" : "course")} className="accent-[var(--accent)]" />
          Limit to this module&apos;s material
        </label>
      )}
    </div>
  );
}
