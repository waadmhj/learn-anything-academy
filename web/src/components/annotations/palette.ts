import type { AnnColor } from "@/lib/types";

/** Colours for text highlights, the marker and sticky notes. */
export const HL_COLORS: AnnColor[] = ["yellow", "green", "blue", "pink", "purple"];
/** Colours for the pen. */
export const INK_COLORS: AnnColor[] = ["ink", "blue", "red", "green", "purple"];

export const COLOR_LABEL: Record<AnnColor, string> = {
  yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink", purple: "Purple", orange: "Orange", red: "Red", ink: "Black",
};

export const hlVar = (c: AnnColor) => `var(--ann-${c}-hl, var(--ann-yellow-hl))`;
export const noteVar = (c: AnnColor) => `var(--ann-${c}-note, var(--ann-yellow-note))`;
export const edgeVar = (c: AnnColor) => `var(--ann-${c}-edge, var(--ann-yellow-edge))`;
export const inkVar = (c: AnnColor) => `var(--ann-${c}-ink, var(--ann-ink-ink))`;
/** Solid swatch colour for pickers and list markers. */
export const dotVar = (c: AnnColor) => `var(--ann-${c}-dot, var(--ann-${c}-ink, var(--ann-yellow-dot)))`;
