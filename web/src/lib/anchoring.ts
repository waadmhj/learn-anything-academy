/**
 * Text anchoring for highlights. A highlight is stored as the quoted text plus a little context and its character
 * offset inside a scope element (`[data-anchor]`), so it can be found again after re-render, resize or small edits.
 */
import type { HighlightData } from "./types";

// Text that is hidden (KaTeX's MathML copy), drawn (SVG) or interactive is not part of the readable text.
const SKIP = "svg, .katex-mathml, script, style, textarea, input, select, button, [data-no-annotate]";
const CONTEXT = 32;

interface Flat {
  nodes: Text[];
  starts: number[];
  text: string;
}

function flatten(scope: Element): Flat {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!t.data.length) continue;
    nodes.push(t);
    starts.push(text.length);
    text += t.data;
  }
  return { nodes, starts, text };
}

function pointToOffset(f: Flat, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const i = f.nodes.indexOf(container as Text);
    if (i >= 0) return f.starts[i] + offset;
  }
  // Boundary sits on an element or inside skipped text: use the first readable text node at or after it.
  const r = document.createRange();
  r.setStart(container, offset);
  for (let i = 0; i < f.nodes.length; i++) if (r.comparePoint(f.nodes[i], 0) >= 0) return f.starts[i];
  return f.text.length;
}

function rangeFromOffsets(f: Flat, start: number, end: number): Range | null {
  let sNode: Text | null = null;
  let sOff = 0;
  for (let i = 0; i < f.nodes.length; i++) {
    const s = f.starts[i];
    const len = f.nodes[i].data.length;
    if (!sNode && start >= s && start < s + len) {
      sNode = f.nodes[i];
      sOff = start - s;
    }
    if (sNode && end > s && end <= s + len) {
      const r = document.createRange();
      r.setStart(sNode, sOff);
      r.setEnd(f.nodes[i], end - s);
      return r;
    }
  }
  return null;
}

/** Describe a selection inside `scope`, trimmed of surrounding whitespace. Null if it holds no readable text. */
export function describeRange(range: Range, scope: Element, scopeId: string): HighlightData | null {
  const f = flatten(scope);
  let start = pointToOffset(f, range.startContainer, range.startOffset);
  let end = pointToOffset(f, range.endContainer, range.endOffset);
  while (start < end && /\s/.test(f.text[start])) start++;
  while (end > start && /\s/.test(f.text[end - 1])) end--;
  if (end <= start) return null;
  return {
    scope: scopeId,
    quote: f.text.slice(start, end).slice(0, 4000),
    prefix: f.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: f.text.slice(end, end + CONTEXT),
    start,
  };
}

function sharedTail(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function sharedHead(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Find a stored highlight again. Exact offset first, then the occurrence whose context matches best. */
export function resolveHighlight(d: HighlightData, scope: Element): Range | null {
  const f = flatten(scope);
  const len = d.quote.length;
  if (f.text.slice(d.start, d.start + len) === d.quote) return rangeFromOffsets(f, d.start, d.start + len);
  let best = -1;
  let bestScore = -Infinity;
  for (let i = f.text.indexOf(d.quote); i !== -1; i = f.text.indexOf(d.quote, i + 1)) {
    const score =
      sharedTail(f.text.slice(Math.max(0, i - d.prefix.length), i), d.prefix) +
      sharedHead(f.text.slice(i + len, i + len + d.suffix.length), d.suffix) -
      Math.abs(i - d.start) / 1e6;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best >= 0 ? rangeFromOffsets(f, best, best + len) : null;
}

/** Caret position under a screen point (for clicking on a highlight). */
export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

export const highlightsSupported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
