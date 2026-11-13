"use client";

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "./ui";

/** Renders trusted course Markdown with GFM tables, KaTeX maths and highlighted code. Raw HTML is not rendered. */
export function Markdown({ children, className, inline }: { children: string; className?: string; inline?: boolean }) {
  return (
    <div className={cn(inline ? "prose [&>p]:inline [&>p]:m-0" : "prose", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
