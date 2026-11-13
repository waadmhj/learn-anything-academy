"use client";

import {
  Brush, ChevronDown, Eraser, Eye, EyeOff, GripHorizontal, Highlighter, Minus, MousePointer2, PenLine, PenTool, Pin, StickyNote, Trash2, Undo2, X,
} from "lucide-react";
import { getStroke } from "perfect-freehand";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { caretAt, describeRange, highlightsSupported, resolveHighlight } from "@/lib/anchoring";
import type { AnnColor, Annotation, NoteData } from "@/lib/types";
import { cn } from "../ui";
import { COLOR_LABEL, HL_COLORS, INK_COLORS, dotVar, edgeVar, hlVar, inkVar, noteVar } from "./palette";
import { keyOf, type AnnotationsApi } from "./use-annotations";

type Tool = "select" | "highlight" | "pen" | "marker" | "eraser" | "note";
type HighlightAnn = Extract<Annotation, { kind: "highlight" }>;
type NoteAnn = Extract<Annotation, { kind: "note" }>;
type InkAnn = Extract<Annotation, { kind: "ink" }>;

const PEN_SIZES = [2.5, 4, 7];
const MARKER_SIZES = [12, 18, 26];
const NOTE_W = 224;
const CURSOR: Record<Tool, string> = { select: "auto", highlight: "text", pen: "crosshair", marker: "crosshair", eraser: "cell", note: "copy" };

interface Prefs { hl: AnnColor; pen: AnnColor; marker: AnnColor; note: AnnColor; penSize: number; markerSize: number; minimized: boolean }
const DEFAULT_PREFS: Prefs = { hl: "yellow", pen: "ink", marker: "yellow", note: "yellow", penSize: 4, markerSize: 18, minimized: false };
const PREFS_KEY = "academy.annotate";

interface Layout { w: number; h: number; tops: Record<string, number>; anchors: { id: string; top: number }[]; v: number }
interface SelInfo { range: Range; scopeEl: HTMLElement; scopeId: string; x: number; top: number; bottom: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

function toPath(outline: number[][]): string {
  if (outline.length < 2) return "";
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(outline[0][0])},${f(outline[0][1])} Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += `${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)} `;
  }
  return d + "Z";
}

function strokePath(pts: number[][], tool: "pen" | "marker", size: number): string {
  const realPressure = pts.some((p) => Math.abs(p[2] - 0.5) > 0.01);
  const outline =
    tool === "pen"
      ? getStroke(pts, { size, thinning: 0.6, smoothing: 0.5, streamline: 0.4, simulatePressure: !realPressure, last: true })
      : getStroke(pts, { size, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last: true });
  return toPath(outline);
}

/** Local text with debounced saving; flushes on blur and unmount. */
function useDebouncedSave(initial: string, save: (t: string) => void, delay = 600) {
  const [text, setText] = useState(initial);
  const saveRef = useRef(save);
  const latest = useRef(initial);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    saveRef.current = save;
  });
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    saveRef.current(latest.current);
  }, []);
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    dirty.current = false;
  }, []);
  const change = useCallback(
    (t: string) => {
      setText(t);
      latest.current = t;
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [flush, delay],
  );
  useEffect(() => flush, [flush]);
  return { text, change, flush, cancel, latest };
}

// ───────────────────────────── Layer ─────────────────────────────

/**
 * Wraps the lesson content and adds a Notability-style annotation layer: text highlights (CSS Custom Highlight API,
 * so the lesson DOM is never modified), sticky notes, and pen/marker ink with an eraser. Positions are stored relative
 * to the nearest `[data-anchor]` element so they follow the content when the page reflows.
 */
export function AnnotationLayer({
  ann, onOrphans, className, contentClassName, children,
}: { ann: AnnotationsApi; onOrphans?: (ids: number[]) => void; className?: string; contentClassName?: string; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>({ w: 0, h: 0, tops: { root: 0 }, anchors: [], v: 0 });
  const [domV, setDomV] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [hidden, setHidden] = useState(false);
  const [supported, setSupported] = useState(false);
  const [live, setLive] = useState<number[][] | null>(null);
  const liveRef = useRef<number[][] | null>(null);
  const [erasing, setErasing] = useState<Set<number>>(new Set());
  const erasingRef = useRef<Set<number> | null>(null);
  const [selPop, setSelPop] = useState<SelInfo | null>(null);
  const [hlPop, setHlPop] = useState<{ key: number; x: number; y: number; focusNote?: boolean } | null>(null);
  const [focusNoteKey, setFocusNoteKey] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [marks, setMarks] = useState<{ key: number; top: number; color: AnnColor }[]>([]);
  const undoStack = useRef<number[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const rangesRef = useRef(new Map<number, Range>());
  const orphanKey = useRef("");
  const penSeen = useRef(false);
  // Fixed-position UI goes to <body>: page wrappers with transforms (fade-in) would otherwise anchor it to the page.
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const { items } = ann;
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  useEffect(() => {
    try {
      setPrefsState({ ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") });
    } catch {
      /* storage unavailable: defaults */
    }
    setSupported(highlightsSupported());
    setPortal(document.body);
  }, []);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* not persisted */
      }
      return next;
    });
  }, []);

  // ── Layout: anchor positions relative to the box ──
  const measure = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const br = box.getBoundingClientRect();
    const anchors = Array.from(content.querySelectorAll<HTMLElement>("[data-anchor]"))
      .map((el) => ({ id: el.dataset.anchor!, top: Math.round(el.getBoundingClientRect().top - br.top) }))
      .sort((a, b) => a.top - b.top);
    const tops: Record<string, number> = { root: 0 };
    anchors.forEach((a) => (tops[a.id] = a.top));
    const w = box.clientWidth;
    const h = content.offsetHeight;
    setLayout((l) => {
      const same = l.w === w && l.h === h && l.anchors.length === anchors.length && anchors.every((a, i) => l.anchors[i].id === a.id && l.anchors[i].top === a.top);
      return same ? l : { w, h, tops, anchors, v: l.v + 1 };
    });
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    measure();
    let t: number | undefined;
    const bump = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        measure();
        setDomV((v) => v + 1);
      }, 120);
    };
    const ro = new ResizeObserver(() => measure());
    ro.observe(content);
    const mo = new MutationObserver(bump);
    mo.observe(content, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
      window.clearTimeout(t);
    };
  }, [measure]);

  const scopeFor = useCallback(
    (y: number) => {
      let id = "root";
      for (const a of layout.anchors) if (a.top <= y + 1) id = a.id;
      return id;
    },
    [layout.anchors],
  );

  // ── Highlights: resolve anchors and register them with CSS.highlights ──
  useEffect(() => {
    const content = contentRef.current;
    const box = boxRef.current;
    if (!supported || !content || !box) return;
    const map = new Map<number, Range>();
    const lost: number[] = [];
    const byColor = new Map<AnnColor, Range[]>();
    for (const a of items) {
      if (a.kind !== "highlight") continue;
      const el = content.querySelector(`[data-annotatable][data-anchor="${CSS.escape(a.data.scope)}"]`);
      const r = el ? resolveHighlight(a.data, el) : null;
      if (!r) {
        lost.push(a.id);
        continue;
      }
      map.set(keyOf(a), r);
      byColor.set(a.color, [...(byColor.get(a.color) ?? []), r]);
    }
    rangesRef.current = map;
    for (const c of HL_COLORS) {
      const rs = hidden ? undefined : byColor.get(c);
      if (rs?.length) CSS.highlights.set(`ann-${c}`, new Highlight(...rs));
      else CSS.highlights.delete(`ann-${c}`);
    }
    const k = lost.join(",");
    if (k !== orphanKey.current) {
      orphanKey.current = k;
      onOrphans?.(lost);
    }
    const br = box.getBoundingClientRect();
    const next = hidden
      ? []
      : items
          .filter((a): a is HighlightAnn => a.kind === "highlight" && !!a.text.trim() && map.has(keyOf(a)))
          .map((a) => ({ key: keyOf(a), color: a.color, top: Math.round(map.get(keyOf(a))!.getBoundingClientRect().top - br.top) }));
    setMarks((m) => (JSON.stringify(m) === JSON.stringify(next) ? m : next));
  }, [items, layout.v, domV, hidden, supported, onOrphans]);

  useEffect(
    () => () => {
      if (!highlightsSupported()) return;
      HL_COLORS.forEach((c) => CSS.highlights.delete(`ann-${c}`));
      CSS.highlights.delete("ann-focus");
    },
    [],
  );

  // ── Text selection → highlight popover / highlighter tool ──
  const readSelection = useCallback((): SelInfo | null => {
    const s = window.getSelection();
    const box = boxRef.current;
    if (!s || s.isCollapsed || !s.rangeCount || !box) return null;
    const range = s.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest<HTMLElement>("[data-annotatable]");
    if (!el || !contentRef.current?.contains(el)) return null;
    const rr = range.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    return { range: range.cloneRange(), scopeEl: el, scopeId: el.dataset.anchor!, x: rr.left + rr.width / 2 - br.left, top: rr.top - br.top, bottom: rr.bottom - br.top };
  }, []);

  useEffect(() => {
    let t: number | undefined;
    const onSel = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setSelPop(readSelection()), 180);
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      window.clearTimeout(t);
    };
  }, [readSelection]);

  const pushUndo = (id: number) => {
    undoStack.current.push(id);
    setUndoCount(undoStack.current.length);
  };

  const createHighlight = (info: SelInfo, color: AnnColor, withNote = false) => {
    const data = describeRange(info.range, info.scopeEl, info.scopeId);
    window.getSelection()?.removeAllRanges();
    setSelPop(null);
    if (!data) return;
    setPrefs({ hl: color });
    const id = ann.create({ kind: "highlight", color, data });
    pushUndo(id);
    if (withNote) setHlPop({ key: id, x: info.x, y: info.bottom + 10, focusNote: true });
  };

  const onContentPointerUp = () => {
    if (tool !== "highlight" || hidden || !supported) return;
    window.setTimeout(() => {
      const info = readSelection();
      if (info) createHighlight(info, prefs.hl);
    }, 0);
  };

  const onContentClick = (e: React.MouseEvent) => {
    if (hidden || (tool !== "select" && tool !== "highlight")) return;
    const s = window.getSelection();
    if (s && !s.isCollapsed) return;
    const c = caretAt(e.clientX, e.clientY);
    if (!c) return;
    let hit: number | null = null;
    for (const [key, r] of rangesRef.current) {
      try {
        if (r.isPointInRange(c.node, c.offset)) hit = key;
      } catch {
        /* node outside the range's document */
      }
    }
    if (hit == null) return;
    const br = boxRef.current!.getBoundingClientRect();
    setHlPop({ key: hit, x: e.clientX - br.left, y: e.clientY - br.top + 14 });
  };

  // ── Ink ──
  const inkItems = useMemo(() => items.filter((a): a is InkAnn => a.kind === "ink"), [items]);
  const inkScreen = useMemo(
    () =>
      new Map(
        inkItems.map((a) => {
          const top = layout.tops[a.data.scope] ?? 0;
          return [a.id, a.data.points.map(([x, dy, p]) => [x * layout.w, top + dy, p])] as const;
        }),
      ),
    [inkItems, layout],
  );
  const inkPaths = useMemo(
    () => new Map(inkItems.map((a) => [a.id, strokePath(inkScreen.get(a.id) ?? [], a.data.tool, a.data.size)] as const)),
    [inkItems, inkScreen],
  );

  const toBox = (e: { clientX: number; clientY: number }) => {
    const br = boxRef.current!.getBoundingClientRect();
    return [e.clientX - br.left, e.clientY - br.top] as const;
  };

  const addNote = (x: number, y: number) => {
    const scope = scopeFor(y);
    const id = ann.create({
      kind: "note", color: prefs.note,
      data: { scope, x: r4(clamp(x / Math.max(1, layout.w), 0, 1)), dy: r1(y - (layout.tops[scope] ?? 0)), collapsed: false },
    });
    pushUndo(id);
    setFocusNoteKey(id);
    setTool("select");
  };

  const eraseAt = (x: number, y: number) => {
    const set = erasingRef.current;
    if (!set) return;
    for (const a of inkItems) {
      if (set.has(a.id)) continue;
      const rad = a.data.size / 2 + 6;
      if (inkScreen.get(a.id)?.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= rad * rad)) set.add(a.id);
    }
    setErasing(new Set(set));
  };

  const finishStroke = () => {
    const pts = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (!pts?.length || !layout.w || (tool !== "pen" && tool !== "marker")) return;
    const scope = scopeFor(pts[0][1]);
    const top = layout.tops[scope] ?? 0;
    const id = ann.create({
      kind: "ink",
      color: tool === "pen" ? prefs.pen : prefs.marker,
      data: {
        scope, tool, size: tool === "pen" ? prefs.penSize : prefs.markerSize,
        points: pts.map(([x, y, p]) => [r4(clamp(x / layout.w, 0, 1)), r1(y - top), r2(p)] as [number, number, number]),
      },
    });
    pushUndo(id);
  };

  const finishErase = () => {
    const ids = [...(erasingRef.current ?? [])];
    erasingRef.current = null;
    setErasing(new Set());
    if (!ids.length) return;
    const gone = ann.remove(ids);
    setToast({ msg: `Erased ${ids.length} ${ids.length === 1 ? "stroke" : "strokes"}`, undo: () => ann.restore(gone) });
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "pen") penSeen.current = true;
    else if (e.pointerType === "touch" && penSeen.current) return; // palm rejection once a stylus is in use
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Stop the follow-up mousedown from moving focus (it would blur a new note) or starting a text selection.
    e.preventDefault();
    const [x, y] = toBox(e);
    if (tool === "note") return addNote(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "eraser") {
      erasingRef.current = new Set();
      return eraseAt(x, y);
    }
    liveRef.current = [[x, y, e.pressure || 0.5]];
    setLive(liveRef.current);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [e.nativeEvent];
    if (tool === "eraser") {
      if (erasingRef.current) for (const ev of events) eraseAt(...toBox(ev));
      return;
    }
    if (!liveRef.current) return;
    for (const ev of events) {
      const [x, y] = toBox(ev);
      liveRef.current.push([x, y, ev.pressure || 0.5]);
    }
    if (liveRef.current.length >= 4900) finishStroke();
    else setLive([...liveRef.current]);
  };

  const onUp = () => (tool === "eraser" ? finishErase() : finishStroke());

  // ── Undo, focus, keyboard ──
  const undo = async () => {
    const id = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (id == null) return;
    const real = await ann.resolve(id);
    if (real != null) ann.remove([real]);
  };
  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  });

  const focusById = (id: number) => {
    const a = itemsRef.current.find((x) => x.id === id);
    if (!a) return;
    setHidden(false);
    if (a.kind === "highlight") {
      const r = rangesRef.current.get(keyOf(a));
      if (!r) return;
      r.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (highlightsSupported()) {
        CSS.highlights.set("ann-focus", new Highlight(r));
        window.setTimeout(() => CSS.highlights.delete("ann-focus"), 1800);
      }
    } else if (a.kind === "note") {
      if (a.data.collapsed) ann.update(a.id, { data: { ...a.data, collapsed: false } });
      window.setTimeout(() => {
        const el = document.getElementById(`ann-${a.id}`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.classList.add("ann-flash");
        window.setTimeout(() => el?.classList.remove("ann-flash"), 1500);
      }, 50);
    }
  };
  const focusRef = useRef(focusById);
  useEffect(() => {
    focusRef.current = focusById;
  });

  const ready = ann.loaded && layout.w > 0;
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      const m = /^#ann-(\d+)$/.exec(location.hash);
      if (m) requestAnimationFrame(() => focusRef.current(Number(m[1])));
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (undoStack.current.length) {
          e.preventDefault();
          undoRef.current();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        setTool("select");
        setHlPop(null);
        return;
      }
      const next = ({ v: "select", h: "highlight", p: "pen", m: "marker", e: "eraser", n: "note" } as Record<string, Tool>)[e.key.toLowerCase()];
      if (next && !hidden) setTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden]);

  // Surface save errors.
  const { error, clearError } = ann;
  useEffect(() => {
    if (!error) return;
    setToast({ msg: error });
    clearError();
  }, [error, clearError]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const drawing = !hidden && (tool === "pen" || tool === "marker" || tool === "eraser" || tool === "note");
  const notes = items.filter((a): a is NoteAnn => a.kind === "note");
  const hlItem = hlPop ? items.find((a): a is HighlightAnn => a.kind === "highlight" && keyOf(a) === hlPop.key) : undefined;
  const liveTool = tool === "marker" ? "marker" : "pen";

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div ref={contentRef} className={cn(contentClassName, drawing && "select-none")} onPointerUp={onContentPointerUp} onClick={onContentClick}>
        {children}
      </div>

      {marks.map((m) => (
        <button
          key={m.key}
          onClick={() => setHlPop({ key: m.key, x: layout.w - 150, y: m.top + 22 })}
          className="absolute -right-8 z-20 hidden size-6 items-center justify-center rounded-md border text-fg-2 shadow-[var(--shadow)] hover:text-fg lg:flex"
          style={{ top: m.top - 2, background: noteVar(m.color), borderColor: edgeVar(m.color) }}
          aria-label="Open the note on this highlight"
        >
          <StickyNote className="size-3.5" />
        </button>
      ))}

      {!hidden && layout.w > 0 && (
        <svg
          className="absolute left-0 top-0 z-10 overflow-visible"
          width={layout.w}
          height={layout.h}
          style={{ pointerEvents: drawing ? "auto" : "none", touchAction: drawing ? "none" : "auto", cursor: CURSOR[tool] }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden
        >
          {inkItems.map((a) => (
            <path
              key={keyOf(a)}
              d={inkPaths.get(a.id)}
              fill={a.data.tool === "pen" ? inkVar(a.color) : hlVar(a.color)}
              className={a.data.tool === "marker" ? "ann-marker" : undefined}
              opacity={erasing.has(a.id) ? 0.2 : 1}
            />
          ))}
          {live && (
            <path
              d={strokePath(live, liveTool, liveTool === "pen" ? prefs.penSize : prefs.markerSize)}
              fill={liveTool === "pen" ? inkVar(prefs.pen) : hlVar(prefs.marker)}
              className={liveTool === "marker" ? "ann-marker" : undefined}
            />
          )}
        </svg>
      )}

      {!hidden &&
        notes.map((a) => (
          <StickyNoteCard
            key={keyOf(a)}
            a={a}
            layout={layout}
            scopeFor={scopeFor}
            autoFocus={focusNoteKey === keyOf(a)}
            onFocused={() => setFocusNoteKey(null)}
            onUpdate={(patch) => ann.update(a.id, patch)}
            onDelete={(latestText) => {
              const gone = ann.remove([a.id]).map((g) => ({ ...g, text: latestText }) as Annotation);
              setToast({ msg: "Note deleted", undo: () => ann.restore(gone) });
            }}
          />
        ))}

      {selPop && !hidden && (
        <div
          className="absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-[var(--shadow-lg)]"
          style={{ left: clamp(selPop.x, 120, layout.w - 120), top: selPop.top - 46 < 0 ? selPop.bottom + 8 : selPop.top - 46 }}
          onPointerDown={(e) => e.preventDefault()}
          role="toolbar"
          aria-label="Highlight selection"
        >
          {supported ? (
            HL_COLORS.map((c) => <Swatch key={c} color={dotVar(c)} label={`Highlight ${COLOR_LABEL[c].toLowerCase()}`} onClick={() => createHighlight(selPop, c)} />)
          ) : (
            <span className="px-2 text-xs text-fg-3">Highlighting needs a newer browser</span>
          )}
          {supported && (
            <>
              <span className="mx-1 h-5 w-px bg-border" />
              <button onClick={() => createHighlight(selPop, prefs.hl, true)} className="flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-fg-2 hover:bg-surface-2 hover:text-fg">
                <StickyNote className="size-3.5" /> Add note
              </button>
            </>
          )}
        </div>
      )}

      {hlPop && hlItem && !hidden && (
        <HighlightPopover
          key={hlPop.key}
          a={hlItem}
          x={hlPop.x}
          y={hlPop.y}
          w={layout.w}
          focusNote={!!hlPop.focusNote}
          onClose={() => setHlPop(null)}
          onUpdate={(patch) => ann.update(hlItem.id, patch)}
          onDelete={(latestText) => {
            const gone = ann.remove([hlItem.id]).map((g) => ({ ...g, text: latestText }) as Annotation);
            setHlPop(null);
            setToast({ msg: "Highlight removed", undo: () => ann.restore(gone) });
          }}
        />
      )}

      {portal &&
        createPortal(
          <>
      <Toolbar
        tool={tool}
        setTool={setTool}
        prefs={prefs}
        setPrefs={setPrefs}
        hidden={hidden}
        setHidden={(h) => {
          setHidden(h);
          if (h) setTool("select");
        }}
        canUndo={undoCount > 0}
        onUndo={undo}
        supported={supported}
      />

      {toast && (
        <div role="status" className="fixed bottom-32 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-fg px-3.5 py-2 text-sm text-bg shadow-[var(--shadow-lg)] lg:bottom-20">
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
          </>,
          portal,
        )}
    </div>
  );
}

// ───────────────────────────── Pieces ─────────────────────────────

function Swatch({ color, label, onClick, selected }: { color: string; label: string; onClick: () => void; selected?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} aria-pressed={selected} className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-surface-2">
      <span className={cn("block size-4 rounded-full", selected && "ring-2 ring-offset-2 ring-offset-surface ring-fg-2")} style={{ background: color }} />
    </button>
  );
}

function IconBtn({ label, onClick, pressed, disabled, children }: { label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-35",
        pressed ? "bg-accent-soft text-accent-text" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

const TOOLS: { id: Tool; label: string; key: string; icon: typeof PenLine }[] = [
  { id: "select", label: "Select and read", key: "V", icon: MousePointer2 },
  { id: "highlight", label: "Highlighter: select text to highlight it", key: "H", icon: Highlighter },
  { id: "pen", label: "Pen", key: "P", icon: PenLine },
  { id: "marker", label: "Marker", key: "M", icon: Brush },
  { id: "eraser", label: "Eraser: drag over pen and marker strokes", key: "E", icon: Eraser },
  { id: "note", label: "Sticky note: click where to place it", key: "N", icon: StickyNote },
];

function Toolbar({
  tool, setTool, prefs, setPrefs, hidden, setHidden, canUndo, onUndo, supported,
}: {
  tool: Tool; setTool: (t: Tool) => void; prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; hidden: boolean; setHidden: (h: boolean) => void;
  canUndo: boolean; onUndo: () => void; supported: boolean;
}) {
  if (prefs.minimized) {
    return (
      <button
        onClick={() => setPrefs({ minimized: false })}
        className="fixed bottom-16 right-4 z-40 flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium shadow-[var(--shadow-lg)] hover:bg-surface-2 lg:bottom-6 lg:right-[19.5rem]"
      >
        <PenTool className="size-4 text-accent" /> Annotate
      </button>
    );
  }
  const colorKey = tool === "highlight" ? "hl" : tool === "pen" ? "pen" : tool === "marker" ? "marker" : tool === "note" ? "note" : null;
  const colors = tool === "pen" ? INK_COLORS : HL_COLORS;
  const sizeKey = tool === "pen" ? "penSize" : tool === "marker" ? "markerSize" : null;
  const sizes = tool === "pen" ? PEN_SIZES : MARKER_SIZES;
  return (
    <div
      role="toolbar"
      aria-label="Annotation tools"
      className="fixed bottom-16 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-2xl border border-border bg-surface/95 p-1 shadow-[var(--shadow-lg)] backdrop-blur scrollbar-thin lg:bottom-6"
    >
      {TOOLS.map(({ id, label, key, icon: Icon }) => (
        <IconBtn
          key={id}
          label={`${label} (${key})`}
          pressed={tool === id}
          disabled={hidden || (id === "highlight" && !supported)}
          onClick={() => setTool(id)}
        >
          <Icon className="size-4" />
        </IconBtn>
      ))}
      {colorKey && !hidden && (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-border" />
          {colors.map((c) => (
            <Swatch
              key={c}
              color={tool === "pen" ? inkVar(c) : dotVar(c)}
              label={COLOR_LABEL[c]}
              selected={prefs[colorKey] === c}
              onClick={() => setPrefs({ [colorKey]: c })}
            />
          ))}
        </>
      )}
      {sizeKey && !hidden && (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-border" />
          {sizes.map((s, i) => (
            <IconBtn key={s} label={["Thin", "Medium", "Thick"][i]} pressed={prefs[sizeKey] === s} onClick={() => setPrefs({ [sizeKey]: s })}>
              <span className="block rounded-full bg-current" style={{ width: 4 + i * 3, height: 4 + i * 3 }} />
            </IconBtn>
          ))}
        </>
      )}
      <span className="mx-1 h-5 w-px shrink-0 bg-border" />
      <IconBtn label="Undo (Ctrl+Z)" disabled={!canUndo || hidden} onClick={onUndo}>
        <Undo2 className="size-4" />
      </IconBtn>
      <IconBtn label={hidden ? "Show my annotations" : "Hide my annotations"} pressed={hidden} onClick={() => setHidden(!hidden)}>
        {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </IconBtn>
      <IconBtn label="Minimise toolbar" onClick={() => setPrefs({ minimized: true })}>
        <ChevronDown className="size-4" />
      </IconBtn>
    </div>
  );
}

function StickyNoteCard({
  a, layout, scopeFor, autoFocus, onFocused, onUpdate, onDelete,
}: {
  a: NoteAnn; layout: Layout; scopeFor: (y: number) => string; autoFocus: boolean; onFocused: () => void;
  onUpdate: (patch: { text?: string; pinned?: boolean; color?: AnnColor; data?: NoteData }) => void; onDelete: (latestText: string) => void;
}) {
  const { text, change, flush, cancel, latest } = useDebouncedSave(a.text, (t) => onUpdate({ text: t }));
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const width = Math.min(NOTE_W, layout.w || NOTE_W);
  const left0 = clamp(a.data.x * layout.w, 0, Math.max(0, layout.w - width));
  const top0 = (layout.tops[a.data.scope] ?? 0) + a.data.dy;
  const left = left0 + (drag?.dx ?? 0);
  const top = top0 + (drag?.dy ?? 0);

  useEffect(() => {
    if (!autoFocus) return;
    ta.current?.focus({ preventScroll: true });
    onFocused();
  }, [autoFocus, onFocused]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, a.data.collapsed]);

  const moveTo = (x: number, y: number) => {
    const nx = clamp(x, 0, Math.max(0, layout.w - width));
    const scope = scopeFor(y);
    onUpdate({ data: { ...a.data, scope, x: r4(layout.w ? nx / layout.w : 0), dy: r1(y - (layout.tops[scope] ?? 0)) } });
  };

  const grip = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, y: e.clientY };
      setDrag({ dx: 0, dy: 0 });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current) setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y });
    },
    onPointerUp: () => {
      if (!start.current) return;
      start.current = null;
      if (drag && (Math.abs(drag.dx) > 2 || Math.abs(drag.dy) > 2)) moveTo(left, top);
      setDrag(null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 32 : 8;
      const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
      if (!d) return;
      e.preventDefault();
      moveTo(left0 + d[0], top0 + d[1]);
    },
  };

  const style = { left, top, background: noteVar(a.color), borderColor: edgeVar(a.color) };
  const domId = a.id > 0 ? `ann-${a.id}` : undefined;

  if (a.data.collapsed) {
    return (
      <button
        id={domId}
        onClick={() => onUpdate({ data: { ...a.data, collapsed: false } })}
        className="absolute z-20 flex size-8 items-center justify-center rounded-lg border text-fg-2 shadow-[var(--shadow-lg)] hover:text-fg"
        style={style}
        aria-label={`Open sticky note${a.text ? `: ${a.text.slice(0, 60)}` : ""}`}
        title={a.text.slice(0, 120) || "Sticky note"}
      >
        <StickyNote className="size-4" />
        {a.pinned && <Pin className="absolute -right-1.5 -top-1.5 size-3 fill-current text-accent" aria-hidden />}
      </button>
    );
  }

  const nextColor = HL_COLORS[(HL_COLORS.indexOf(a.color) + 1) % HL_COLORS.length];
  return (
    <div id={domId} className="absolute z-20 flex flex-col rounded-lg border shadow-[var(--shadow-lg)]" style={{ ...style, width }}>
      <div className="flex items-center gap-0.5 px-1 pt-1 text-fg-3">
        <button {...grip} aria-label="Move note: drag it, or use the arrow keys" className={cn("touch-none rounded p-1 hover:text-fg", drag ? "cursor-grabbing" : "cursor-grab")}>
          <GripHorizontal className="size-4" />
        </button>
        <span className="flex-1" />
        <button onClick={() => onUpdate({ color: nextColor })} aria-label={`Colour: ${COLOR_LABEL[a.color]}. Change to ${COLOR_LABEL[nextColor]}`} className="rounded p-1 hover:text-fg">
          <span className="block size-3 rounded-full" style={{ background: dotVar(a.color) }} />
        </button>
        <button
          onClick={() => onUpdate({ pinned: !a.pinned })}
          aria-pressed={a.pinned}
          aria-label={a.pinned ? "Unpin note" : "Pin note to your notebook and dashboard"}
          title={a.pinned ? "Unpin" : "Pin"}
          className={cn("rounded p-1 hover:text-fg", a.pinned && "text-accent")}
        >
          <Pin className={cn("size-3.5", a.pinned && "fill-current")} />
        </button>
        <button
          onClick={() => {
            flush();
            onUpdate({ data: { ...a.data, collapsed: true } });
          }}
          aria-label="Collapse note"
          title="Collapse"
          className="rounded p-1 hover:text-fg"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          onClick={() => {
            cancel();
            onDelete(latest.current);
          }}
          aria-label="Delete note"
          title="Delete"
          className="rounded p-1 hover:text-danger"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <textarea
        ref={ta}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={flush}
        placeholder="Write a note…"
        aria-label="Note text"
        rows={2}
        className="w-full resize-none bg-transparent px-3 pb-3 pt-1 text-sm leading-relaxed text-fg placeholder:text-fg-3 focus:outline-none"
      />
    </div>
  );
}

function HighlightPopover({
  a, x, y, w, focusNote, onClose, onUpdate, onDelete,
}: {
  a: HighlightAnn; x: number; y: number; w: number; focusNote: boolean; onClose: () => void;
  onUpdate: (patch: { text?: string; pinned?: boolean; color?: AnnColor }) => void; onDelete: (latestText: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { text, change, flush, cancel, latest } = useDebouncedSave(a.text, (t) => onUpdate({ text: t }));
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const W = Math.min(288, w);
  return (
    <div ref={ref} role="dialog" aria-label="Highlight" className="absolute z-30 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-lg)]" style={{ left: clamp(x - W / 2, 0, Math.max(0, w - W)), top: y, width: W }}>
      <div className="flex items-center gap-0.5">
        {HL_COLORS.map((c) => (
          <Swatch key={c} color={dotVar(c)} label={COLOR_LABEL[c]} selected={a.color === c} onClick={() => onUpdate({ color: c })} />
        ))}
        <span className="flex-1" />
        <IconBtn label={a.pinned ? "Unpin" : "Pin to your notebook and dashboard"} pressed={a.pinned} onClick={() => onUpdate({ pinned: !a.pinned })}>
          <Pin className={cn("size-4", a.pinned && "fill-current")} />
        </IconBtn>
        <IconBtn
          label="Remove highlight"
          onClick={() => {
            cancel();
            onDelete(latest.current);
          }}
        >
          <Trash2 className="size-4" />
        </IconBtn>
      </div>
      <textarea
        autoFocus={focusNote}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={flush}
        placeholder="Add a note to this highlight…"
        aria-label="Note on this highlight"
        rows={3}
        className="mt-2 w-full resize-none rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-sm leading-relaxed focus:border-accent focus:outline-none"
      />
      <p className="mt-1 text-[11px] text-fg-3">Saved automatically</p>
    </div>
  );
}
