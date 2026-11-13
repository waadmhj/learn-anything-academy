"use client";

import { BookOpen, ExternalLink, Eye, FileText, GraduationCap, Loader2, Maximize2, MessagesSquare, Minimize2, MonitorPlay, Newspaper, PlayCircle, ScrollText, Sparkles, Star, ThumbsUp, TrendingUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { Resource, ResourceView } from "@/lib/types";
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
  arxiv: "arXiv", youtube: "YouTube", internetarchive: "Internet Archive", web: "Web",
};

/** The evidence that this resource is well regarded (points, ratings, citations, likes, views). */
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
  } else if (r.source === "internetarchive" && r.score) text = `${n(r.score)} views`;
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

export function isPlayable(r: Resource) {
  return r.type === "video" || Boolean(r.embed.youtube || r.embed.archive);
}

/** A player URL we can build without asking the server (YouTube and Internet Archive). */
function directPlayer(r: Resource): string | null {
  if (r.embed.youtube) return `https://www.youtube-nocookie.com/embed/${r.embed.youtube}?rel=0&modestbranding=1`;
  if (r.embed.archive) return `https://archive.org/embed/${encodeURIComponent(r.embed.archive)}`;
  return null;
}

function Player({ src, title, start = 0 }: { src: string; title: string; start?: number }) {
  const url = start ? `${src}${src.includes("?") ? "&" : "?"}start=${start}&autoplay=1` : src;
  return (
    <div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
      <iframe
        key={url}
        src={url}
        title={title}
        className="size-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

type ViewState = { key: string; view?: ResourceView; error?: string };

function useResourceView(id: string, opts: { reader?: boolean; discussion?: boolean; enabled: boolean }) {
  const params = new URLSearchParams();
  if (opts.reader) params.set("reader", "true");
  if (opts.discussion) params.set("discussion", "true");
  const path = `/resources/${id}/view${params.size ? `?${params}` : ""}`;
  const [state, setState] = useState<ViewState>({ key: "" });
  useEffect(() => {
    if (!opts.enabled) return;
    let alive = true;
    api<ResourceView>(path)
      .then((view) => alive && setState({ key: path, view }))
      .catch((e: Error) => alive && setState({ key: path, error: e.message || "Couldn't load this resource." }));
    return () => {
      alive = false;
    };
  }, [path, opts.enabled]);
  return state.key === path ? state : { key: path };
}

/** Videos play inline: directly for YouTube/Internet Archive, via the server for Vimeo, playlists and channels. */
export function VideoPlayer({ resource }: { resource: Resource }) {
  const [start, setStart] = useState(0);
  const direct = directPlayer(resource);
  const { view, error } = useResourceView(resource.id, { enabled: !direct });
  const src = direct ?? (view?.mode === "video" ? view.player : null);
  const chapters = resource.chapters.filter((c): c is { t: string; label: string } => typeof c === "object");
  if (!src) {
    if (view || error) {
      return (
        <p className="rounded-lg bg-surface-2 p-3 text-sm text-fg-2">
          {view?.mode === "link" ? view.reason : (error ?? "This video can't be played here.")}{" "}
          <a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">Open it on its site</a>
        </p>
      );
    }
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl border border-border bg-surface-2">
        <Loader2 className="size-5 animate-spin text-fg-3" />
      </div>
    );
  }
  return (
    <div>
      <Player src={src} title={resource.title} start={resource.embed.youtube ? start : 0} />
      {chapters.length > 0 && resource.embed.youtube && (
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

/** Kept for existing imports: the lesson's featured video. */
export const YouTubeEmbed = VideoPlayer;

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

/** Shows any resource inside the platform: a player, the embedded page, or a clean reading view. The original is one click away. */
export function ResourceViewer({ resource, onClose, discussion }: { resource: Resource; onClose: () => void; discussion?: boolean }) {
  const [reader, setReader] = useState(false);
  const [wide, setWide] = useState(false);
  const { view, error } = useResourceView(resource.id, { reader, discussion, enabled: true });
  const title = discussion ? `Discussion: ${resource.title}` : resource.title;
  const original = discussion ? (resource.discussion_url ?? resource.url) : resource.url;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const canToggle = view && ((view.mode === "iframe" && view.reader) || (view.mode === "reader" && view.iframe));
  return createPortal(
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={title}>
      <div className="hidden flex-1 bg-black/40 md:block" onClick={onClose} />
      <div className={cn("flex h-full w-full flex-col border-l border-border bg-surface shadow-[var(--shadow-lg)]", wide ? "md:w-full" : "md:w-[min(1000px,75vw)]")}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="truncate text-xs text-fg-3">
              {discussion ? "Hacker News" : resource.provider}
              {!discussion && resource.authors ? ` · ${resource.authors}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canToggle && (
              <Button size="sm" variant="secondary" onClick={() => setReader(!reader)}>
                {view.mode === "reader" ? "Original layout" : "Reading view"}
              </Button>
            )}
            <a href={original} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-fg-3 hover:bg-surface-2 hover:text-fg" title="Open the original site in a new tab">
              Source <ExternalLink className="size-3" />
            </a>
            <button onClick={() => setWide(!wide)} className="hidden rounded-md p-1.5 text-fg-3 hover:bg-surface-2 md:block" aria-label={wide ? "Narrower" : "Full width"}>
              {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 hover:bg-surface-2" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!view && !error && (
            <div className="flex h-full items-center justify-center gap-2 px-6 text-center text-sm text-fg-3">
              <Loader2 className="size-4 shrink-0 animate-spin" /> Preparing “{title}”…
            </div>
          )}
          {error && <p className="m-6 rounded-lg bg-surface-2 p-4 text-sm text-fg-2">{error}</p>}
          {view?.mode === "video" && (
            <div className="mx-auto max-w-4xl p-4 sm:p-6">
              <Player src={view.player} title={title} />
              {resource.summary && <p className="mt-4 whitespace-pre-line text-sm text-fg-2">{resource.summary}</p>}
            </div>
          )}
          {view?.mode === "iframe" && (
            <iframe src={view.src} title={title} className="size-full bg-white" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads" referrerPolicy="no-referrer" />
          )}
          {view?.mode === "reader" && (
            <article className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
              {view.title && <h1 className="mb-4 text-2xl font-semibold tracking-tight">{view.title}</h1>}
              {/* Sanitised on the server (allowlisted tags and attributes, http(s) links only). */}
              <div className="prose reader" dangerouslySetInnerHTML={{ __html: view.html }} />
              <p className="mt-10 border-t border-border pt-3 text-xs text-fg-3">
                {view.credit}{" "}
                <a href={view.url} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">Original</a>
              </p>
            </article>
          )}
          {view?.mode === "link" && (
            <div className="mx-auto max-w-lg p-8 text-center">
              <p className="text-sm text-fg-2">{view.reason}</p>
              <a href={view.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                Open {resource.provider || "the site"} <ExternalLink className="size-3.5" />
              </a>
              {resource.summary && <p className="mt-6 text-left text-sm text-fg-2">{resource.summary}</p>}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ResourceCard({ r, compact, showVideo }: { r: Resource; compact?: boolean; showVideo?: boolean }) {
  const [viewer, setViewer] = useState<false | "resource" | "discussion">(false);
  const [playing, setPlaying] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const playable = isPlayable(r);
  const showPlayer = (showVideo || playing) && playable;
  const open = () => (playable ? setPlaying(true) : setViewer("resource"));
  const meta = TYPE_META[r.type];
  const Icon = meta.icon;
  return (
    <div className={cn("rounded-xl border border-border bg-surface", compact ? "p-3" : "p-4")}>
      {showPlayer && (
        <div className="mb-3">
          <VideoPlayer resource={r} />
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
          <button onClick={open} className={cn("mt-1.5 block text-left font-medium leading-snug hover:text-accent-text", compact ? "text-[13px]" : "text-sm")}>
            {r.title}
          </button>
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
            {playable
              ? !showPlayer && (
                  <Button size="sm" onClick={() => setPlaying(true)}>
                    <PlayCircle className="size-3.5" /> Watch here
                  </Button>
                )
              : (
                  <Button size="sm" variant="secondary" onClick={() => setViewer("resource")}>
                    <Eye className="size-3.5" /> {r.type === "book" ? "View book" : r.type === "discussion" ? "Read discussion" : r.type === "paper" ? "Read paper" : "Read here"}
                  </Button>
                )}
            {r.discussion_url && r.discussion_url !== r.url && (
              <button onClick={() => setViewer("discussion")} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
                <MessagesSquare className="size-3.5" /> HN discussion
              </button>
            )}
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-fg-3 hover:bg-surface-2 hover:text-fg" title="Open the original site in a new tab">
              Source <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>
      {viewer && <ResourceViewer resource={r} discussion={viewer === "discussion"} onClose={() => setViewer(false)} />}
    </div>
  );
}
