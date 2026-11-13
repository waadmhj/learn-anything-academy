"use client";

import { BookOpen, ExternalLink, FileText, GraduationCap, MessagesSquare, MonitorPlay, Newspaper, PlayCircle, ScrollText, Sparkles, Star, ThumbsUp, TrendingUp, X } from "lucide-react";
import { useState } from "react";
import type { Resource } from "@/lib/types";
import { Badge, Button, cn } from "./ui";

export const TYPE_META: Record<Resource["type"], { label: string; icon: typeof BookOpen }> = {
  video: { label: "Video", icon: PlayCircle },
  book: { label: "Book", icon: BookOpen },
  docs: { label: "Documentation", icon: FileText },
  course: { label: "Course", icon: GraduationCap },
  paper: { label: "Paper", icon: ScrollText },
  interactive: { label: "Interactive", icon: MonitorPlay },
  article: { label: "Article", icon: Newspaper },
  discussion: { label: "Discussion", icon: MessagesSquare },
};

export const SOURCE_LABEL: Record<Resource["source"], string> = {
  hackernews: "Hacker News", wikipedia: "Wikipedia", openlibrary: "Open Library", semanticscholar: "Semantic Scholar",
  arxiv: "arXiv", youtube: "YouTube", web: "Web",
};

/** The evidence that this resource is well regarded (points, ratings, citations, likes). */
export function QualitySignal({ r }: { r: Resource }) {
  const n = (v: number | null) => (v ?? 0).toLocaleString();
  let icon = TrendingUp;
  let text: string | null = null;
  if (r.source === "hackernews" && r.recommended_by) {
    icon = ThumbsUp;
    text = `Recommended by ${r.recommended_by} HN commenters`;
  } else if (r.source === "hackernews" && r.score) text = `${n(r.score)} points · ${n(r.comments)} comments on HN`;
  else if (r.source === "openlibrary" && (r.rating || r.score)) {
    icon = Star;
    text = [r.rating ? `${r.rating.toFixed(1)}/5` : null, r.score ? `${n(r.score)} readers` : null].filter(Boolean).join(" · ");
  } else if (r.source === "semanticscholar" && r.score) text = `Cited by ${n(r.score)}`;
  else if (r.source === "youtube" && r.score) {
    icon = ThumbsUp;
    text = `${n(r.score)} likes`;
  }
  if (!text) return null;
  const Icon = icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning" title={`Quality signal from ${SOURCE_LABEL[r.source]}`}>
      <Icon className="size-3" /> {text}
    </span>
  );
}

const COST_TONE = { free: "success", audit: "info", freemium: "info", paid: "warning", "": "neutral" } as const;
const COST_LABEL = { free: "Free", audit: "Free to audit", freemium: "Free tier", paid: "Usually paid", "": "" } as const;

function toSeconds(t: string) {
  return t.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function YouTubeEmbed({ resource }: { resource: Resource }) {
  const [start, setStart] = useState(0);
  const id = resource.embed.youtube!;
  const chapters = resource.chapters.filter((c): c is { t: string; label: string } => typeof c === "object");
  return (
    <div>
      <div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
        <iframe
          key={start}
          src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1${start ? `&start=${start}&autoplay=1` : ""}`}
          title={resource.title}
          className="size-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {chapters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Jump to section">
          {chapters.map((c) => (
            <button key={c.t} onClick={() => setStart(toSeconds(c.t))} className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-2 hover:border-accent hover:text-accent-text">
              <span className="font-mono tabular-nums">{c.t}</span> · {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BookCover({ r }: { r: Resource }) {
  const [failed, setFailed] = useState(false);
  if (r.isbn && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote cover from Open Library, size unknown
      <img src={`https://covers.openlibrary.org/b/isbn/${r.isbn}-M.jpg?default=false`} alt={`Cover of ${r.title}`} onError={() => setFailed(true)} className="h-28 w-20 shrink-0 rounded-md border border-border object-cover" loading="lazy" />
    );
  }
  return (
    <div className="flex h-28 w-20 shrink-0 flex-col justify-between rounded-md border border-border bg-gradient-to-b from-accent-soft to-surface-2 p-2">
      <span className="line-clamp-4 text-[10px] font-semibold leading-tight">{r.title}</span>
      <span className="line-clamp-2 text-[9px] text-fg-3">{r.authors}</span>
    </div>
  );
}

/** In-platform reader for docs/books/interactive tools that allow embedding; always offers the original link. */
export function ReaderDrawer({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={`Reader: ${resource.title}`}>
      <div className="hidden flex-1 bg-black/30 md:block" onClick={onClose} />
      <div className="flex h-full w-full flex-col border-l border-border bg-surface shadow-[var(--shadow-lg)] md:w-[min(900px,70vw)] fade-in">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{resource.title}</p>
            <p className="truncate text-xs text-fg-3">{resource.provider}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline">
              Open original <ExternalLink className="size-3" />
            </a>
            <button onClick={onClose} className="rounded-md p-1.5 hover:bg-surface-2" aria-label="Close reader">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <p className="border-b border-border bg-surface-2 px-4 py-1.5 text-[11px] text-fg-3">
          Some sites don&apos;t allow embedding. If this panel stays blank, use “Open original”. The lesson stays open in this tab.
        </p>
        <iframe src={resource.embed.iframe} title={resource.title} className="flex-1 bg-white" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerPolicy="no-referrer" />
      </div>
    </div>
  );
}

export function ResourceCard({ r, compact, showVideo }: { r: Resource; compact?: boolean; showVideo?: boolean }) {
  const [reader, setReader] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const meta = TYPE_META[r.type];
  const Icon = meta.icon;
  return (
    <div className={cn("rounded-xl border border-border bg-surface", compact ? "p-3" : "p-4")}>
      {showVideo && r.embed.youtube && (
        <div className="mb-3">
          <YouTubeEmbed resource={r} />
        </div>
      )}
      <div className="flex gap-3">
        {r.type === "book" && !compact && <BookCover r={r} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>
              <Icon className="size-3" /> {meta.label}
            </Badge>
            {r.role === "required" && <Badge tone="accent">Required</Badge>}
            {r.role === "supplementary" && <Badge>Supplementary</Badge>}
            {r.cost && <Badge tone={COST_TONE[r.cost]}>{COST_LABEL[r.cost]}</Badge>}
            <QualitySignal r={r} />
            {!compact && r.source !== "web" && <span className="text-[11px] text-fg-3">via {SOURCE_LABEL[r.source]}</span>}
          </div>
          <a href={r.url} target="_blank" rel="noopener noreferrer" className={cn("mt-1.5 block font-medium leading-snug hover:text-accent-text", compact ? "text-[13px]" : "text-sm")}>
            {r.title}
          </a>
          <p className="mt-0.5 text-xs text-fg-3">
            {r.provider}
            {r.authors && ` · ${r.authors}`}
            {r.year && ` · ${r.year}`}
            {r.duration && ` · ${r.duration}`}
          </p>
          {!compact && <p className="mt-1.5 text-[13px] text-fg-2">{r.why}</p>}
          {!compact && r.type === "book" && r.chapters.length > 0 && (
            <p className="mt-1.5 text-xs text-fg-3">Relevant: {r.chapters.filter((c) => typeof c === "string").join(" · ")}</p>
          )}
          {r.type === "paper" && r.summary && (
            <div className="mt-2">
              <button onClick={() => setPaperOpen(!paperOpen)} className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline" aria-expanded={paperOpen}>
                <Sparkles className="size-3" /> {paperOpen ? "Hide" : "Show"} summary
              </button>
              {paperOpen && (
                <div className="mt-2 space-y-2 rounded-lg bg-surface-2 p-3 text-[13px]">
                  <p>{r.summary}</p>
                  {r.impact && (
                    <p>
                      <span className="font-medium">Why it matters: </span>
                      {r.impact}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {r.embed.iframe && (
              <Button size="sm" variant="secondary" onClick={() => setReader(true)}>
                Read in platform
              </Button>
            )}
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
              Open <ExternalLink className="size-3" />
            </a>
            {r.discussion_url && r.discussion_url !== r.url && (
              <a href={r.discussion_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
                <MessagesSquare className="size-3.5" /> HN discussion
              </a>
            )}
          </div>
        </div>
      </div>
      {reader && <ReaderDrawer resource={r} onClose={() => setReader(false)} />}
    </div>
  );
}
