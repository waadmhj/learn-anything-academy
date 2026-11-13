"use client";

import {
  BarChart3, BookOpen, Bot, ClipboardCheck, FolderKanban, GraduationCap, Home, Layers, LayoutDashboard, Library, Map, NotebookPen,
  Menu, Moon, Plus, Search, Settings, Sun, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useCurrentCourse } from "@/lib/course";
import { cn } from "./ui";

const TOP = [
  { href: "/", label: "My courses", icon: Home },
  { href: "/new", label: "New course", icon: Plus },
];
const COURSE = [
  { href: "", label: "Dashboard", icon: LayoutDashboard },
  { href: "/paths", label: "Learning path", icon: Map },
  { href: "/curriculum", label: "Curriculum", icon: BookOpen },
  { href: "/resources", label: "Resources", icon: Library },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tutor", label: "Tutor", icon: Bot },
  { href: "/assessments", label: "Assessments", icon: ClipboardCheck },
  { href: "/progress", label: "Progress", icon: BarChart3 },
];
const STUDY = [
  { href: "/flashcards", label: "Flashcards", icon: Layers },
  { href: "/notebook", label: "Notebook", icon: NotebookPen },
  { href: "/settings", label: "Settings", icon: Settings },
];

type Theme = "system" | "light" | "dark";

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    localStorage.setItem("academy.theme", t);
  } catch {
    /* ignore */
  }
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem("academy.theme") as Theme | null;
      } catch {
        return null;
      }
    })();
    setDark(saved === "dark" || ((!saved || saved === "system") && matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);
  const toggle = () => {
    applyTheme(dark ? "light" : "dark");
    setDark(!dark);
  };
  return (
    <button onClick={toggle} className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title="Toggle theme">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

interface SearchResults {
  courses: { id: number; title: string }[];
  lessons: { id: string; title: string }[];
  modules: { id: string; title: string }[];
  resources: { id: string; title: string; type: string; provider: string; course_id: number }[];
  projects: { id: string; title: string; level: string }[];
}

function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const t = setTimeout(() => {
      api<SearchResults>(`/search?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes(null));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    onNavigate?.();
    router.push(href);
  };
  const items = res
    ? [
        ...res.courses.map((c) => ({ href: `/courses/${c.id}`, label: c.title, kind: "Course" })),
        ...res.lessons.map((l) => ({ href: `/lessons/${l.id}`, label: l.title, kind: "Lesson" })),
        ...res.modules.map((m) => ({ href: `/modules/${m.id}`, label: m.title, kind: "Module" })),
        ...res.projects.map((p) => ({ href: `/projects/${p.id}`, label: p.title, kind: "Project" })),
        ...res.resources.map((r) => ({ href: `/courses/${r.course_id}/resources?focus=${r.id}`, label: r.title, kind: r.type })),
      ]
    : [];

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && items[0]) go(items[0].href);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search…"
        aria-label="Search"
        className="h-8 w-full rounded-lg border border-border bg-surface pl-8 pr-10 text-[13px] placeholder:text-fg-3 focus:border-accent focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border px-1 text-[10px] text-fg-3">Ctrl K</kbd>
      {open && items.length > 0 && (
        <div className="absolute left-0 right-0 top-9 z-50 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-[var(--shadow-lg)] scrollbar-thin">
          {items.slice(0, 14).map((it) => (
            <button key={it.href + it.label} onMouseDown={(e) => e.preventDefault()} onClick={() => go(it.href)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2">
              <span className="w-16 shrink-0 text-[11px] capitalize text-fg-3">{it.kind}</span>
              <span className="truncate">{it.label}</span>
            </button>
          ))}
        </div>
      )}
      {open && res && items.length === 0 && (
        <div className="absolute left-0 right-0 top-9 z-50 rounded-lg border border-border bg-surface p-3 text-[13px] text-fg-3 shadow-[var(--shadow-lg)]">No matches for “{q}”.</div>
      )}
    </div>
  );
}

function NavLink({ href, label, icon: Icon, active, onNavigate }: { href: string; label: string; icon: typeof Home; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active ? "bg-surface-2 text-fg" : "text-fg-2 hover:bg-surface-2/70 hover:text-fg",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-fg-3")} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const { course } = useCurrentCourse();
  const base = course ? `/courses/${course.id}` : null;
  const inCourseContent = path.startsWith("/lessons") || path.startsWith("/modules");
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        {TOP.map((n) => (
          <NavLink key={n.href} {...n} active={n.href === "/" ? path === "/" : path.startsWith(n.href)} onNavigate={onNavigate} />
        ))}
      </div>
      {base && course && (
        <div className="flex flex-col gap-0.5">
          <p className="truncate px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-3" title={course.title}>{course.title}</p>
          {COURSE.map((n) => {
            const href = base + n.href;
            const active = n.href === "" ? path === base : path.startsWith(href) || (n.href === "/curriculum" && inCourseContent) || (n.href === "/projects" && path.startsWith("/projects"));
            return <NavLink key={n.label} href={href} label={n.label} icon={n.icon} active={active} onNavigate={onNavigate} />;
          })}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-3">Study</p>
        {STUDY.map((n) => (
          <NavLink key={n.href} {...n} active={path.startsWith(n.href)} onNavigate={onNavigate} />
        ))}
      </div>
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-1">
      <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-white">
        <GraduationCap className="size-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold">Learn Anything Academy</span>
        <span className="block text-[11px] text-fg-3">Any subject, done properly</span>
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  if (path.startsWith("/login")) return <>{children}</>;
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-5 overflow-y-auto border-r border-border bg-bg-subtle px-3 py-4 scrollbar-thin lg:flex">
        <Brand />
        <SearchBox />
        <Nav />
        <div className="mt-auto flex items-center justify-between px-1 text-[11px] text-fg-3">
          <span>Theme</span>
          <ThemeToggle />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-bg/90 px-4 backdrop-blur lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-fg-2 hover:bg-surface-2" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-5 overflow-y-auto bg-bg-subtle px-3 py-4 shadow-[var(--shadow-lg)] fade-in">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-fg-2 hover:bg-surface-2" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <SearchBox onNavigate={() => setOpen(false)} />
            <Nav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
