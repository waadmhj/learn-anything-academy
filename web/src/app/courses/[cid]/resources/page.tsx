"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ResourceCard, TYPE_META } from "@/components/resources";
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useCoursePage } from "@/lib/course";
import { SOURCE_LABEL } from "@/components/resources";
import type { Resource } from "@/lib/types";

const selectCls = "h-8 rounded-lg border border-border bg-surface px-2 text-[13px] focus:border-accent focus:outline-none";

function ResourcesInner() {
  const params = useSearchParams();
  const focus = params.get("focus");
  const [type, setType] = useState(params.get("type") ?? "");
  const [source, setSource] = useState("");
  const { base } = useCoursePage();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams(Object.entries({ type, source, q: debounced }).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useApi<Resource[]>(`${base}/resources${qs ? `?${qs}` : ""}`);
  useEffect(() => {
    if (focus && data) document.getElementById(`r-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (data ?? []).forEach((r) => (c[r.type] = (c[r.type] ?? 0) + 1));
    return c;
  }, [data]);

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Resource library"
        title="The best-rated material for this course"
        description="Found on Hacker News (top-voted stories and links that several commenters recommend), Open Library (reader ratings), research indexes (citations) and Wikipedia, then matched to the lessons they teach. Every link is real; the badge shows why it made the cut."
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, provider…" aria-label="Search resources" className={`${selectCls} w-64 max-w-full`} />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className={selectCls}>
          <option value="">All types</option>
          {Object.entries(TYPE_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className={selectCls}>
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABEL).filter(([k]) => k !== "web").map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {data && (
          <span className="text-xs text-fg-3">
            {data.length} resources{type ? "" : ` · ${Object.entries(counts).map(([k, n]) => `${n} ${TYPE_META[k as Resource["type"]].label.toLowerCase()}`).join(", ")}`}
          </span>
        )}
      </div>
      {loading && !data ? (
        <PageSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data?.length ? (
        <EmptyState title="No resources match these filters" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((r) => (
            <div key={r.id} id={`r-${r.id}`} className={focus === r.id ? "rounded-xl ring-2 ring-accent" : ""}>
              <ResourceCard r={r} />
              {r.lessons && r.lessons.length > 0 && (
                <p className="mt-1.5 px-1 text-xs text-fg-3">
                  Used in:{" "}
                  {r.lessons.slice(0, 4).map((l, i) => (
                    <span key={l.id}>
                      {i > 0 && " · "}
                      <Link href={`/lessons/${l.id}`} className="hover:text-accent-text hover:underline">{l.title}</Link>
                    </span>
                  ))}
                  {r.lessons.length > 4 && ` +${r.lessons.length - 4} more`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResourcesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ResourcesInner />
    </Suspense>
  );
}
